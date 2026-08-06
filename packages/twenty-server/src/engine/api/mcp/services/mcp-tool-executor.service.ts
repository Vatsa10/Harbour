import { Injectable } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import { type ToolSet } from 'ai';
import { isDefined } from 'twenty-shared/utils';

import { TOOL_EXECUTION_DURATION_MS_BUCKET_BOUNDARIES } from 'src/engine/core-modules/metrics/constants/tool-execution-duration-ms-bucket-boundaries.constant';
import { TOOL_OUTPUT_TOKENS_BUCKET_BOUNDARIES } from 'src/engine/core-modules/metrics/constants/tool-output-tokens-bucket-boundaries.constant';
import { MetricsService } from 'src/engine/core-modules/metrics/metrics.service';
import { MetricsKeys } from 'src/engine/core-modules/metrics/types/metrics-keys.type';
import { estimateToolOutputTokens } from 'src/engine/core-modules/tool-provider/utils/estimate-tool-output-tokens.util';
import { getToolMetricName } from 'src/engine/core-modules/tool-provider/utils/get-tool-metric-name.util';
import { isToolOutputSuccessful } from 'src/engine/core-modules/tool-provider/utils/is-tool-output-successful.util';
import { resolveToolName } from 'src/engine/core-modules/tool-provider/utils/resolve-tool-name.util';

import { JSON_RPC_ERROR_CODE } from 'src/engine/api/mcp/constants/json-rpc-error-code.const';
import {
  MCP_PROGRESS_NOTIFICATION_METHOD,
  TOOL_CALL_PROGRESS_TOKEN_PREFIX,
} from 'src/engine/api/mcp/constants/mcp-progress-notification.const';
import { type McpToolAnnotations } from 'src/engine/api/mcp/types/mcp-tool-annotations.type';
import { wrapJsonRpcResponse } from 'src/engine/api/mcp/utils/wrap-jsonrpc-response.util';
import {
  buildToolFailure,
  toFailedToolOutput,
} from 'src/engine/core-modules/tool/utils/build-tool-failure.util';

type McpToolDefinition = ToolSet[string] & {
  annotations?: McpToolAnnotations;
};

const unwrapJsonSchema = (schema: unknown) =>
  schema && typeof schema === 'object' && 'jsonSchema' in schema
    ? schema.jsonSchema
    : schema;

@Injectable()
export class McpToolExecutorService {
  constructor(private readonly metricsService: MetricsService) {}

  async handleToolCall(
    id: string | number,
    toolSet: ToolSet,
    params: Record<string, unknown>,
    sseWriter?: (data: Record<string, unknown>) => void,
  ) {
    if (!isNonEmptyString(params.name)) {
      const failure = buildToolFailure({
        code: 'INVALID_ARGUMENTS',
        message: 'Tool name is required',
        hint: 'Call tools/list first to see available tool names.',
        retryable: false,
      });

      return wrapJsonRpcResponse(id, {
        error: {
          code: JSON_RPC_ERROR_CODE.INVALID_PARAMS,
          message: failure.message,
          data: { failure },
        },
      });
    }

    const toolName = params.name;
    const tool = toolSet[toolName];

    if (!isDefined(tool) || !isDefined(tool.execute)) {
      const failure = buildToolFailure({
        code: 'UNKNOWN_TOOL',
        message: `Unknown tool: ${toolName}`,
        hint: 'Call tools/list to see the tools available to this session.',
        retryable: false,
      });

      return wrapJsonRpcResponse(id, {
        error: {
          code: JSON_RPC_ERROR_CODE.INVALID_PARAMS,
          message: failure.message,
          data: { failure },
        },
      });
    }

    if (isDefined(sseWriter)) {
      sseWriter({
        jsonrpc: '2.0',
        method: MCP_PROGRESS_NOTIFICATION_METHOD,
        params: {
          progressToken: `${TOOL_CALL_PROGRESS_TOKEN_PREFIX}${String(id)}`,
          progress: 0,
          total: 1,
        },
      });
    }

    const metricToolName = getToolMetricName(
      resolveToolName({
        toolName,
        input: params.arguments,
      }),
    );

    const executionStartedAt = performance.now();

    try {
      const result = await tool.execute(params.arguments, {
        toolCallId: '1',
        messages: [],
      });

      this.metricsService.recordHistogram({
        key: MetricsKeys.McpToolExecutionDurationMs,
        value: performance.now() - executionStartedAt,
        unit: 'ms',
        attributes: { tool: metricToolName },
        bucketBoundaries: TOOL_EXECUTION_DURATION_MS_BUCKET_BOUNDARIES,
      });

      const succeeded = isToolOutputSuccessful(result);

      this.metricsService.incrementCounterBy({
        key: succeeded
          ? MetricsKeys.McpToolExecutionSucceeded
          : MetricsKeys.McpToolExecutionFailed,
        amount: 1,
        attributes: { tool: metricToolName },
      });

      this.metricsService.recordHistogram({
        key: MetricsKeys.McpToolOutputTokens,
        value: estimateToolOutputTokens(result),
        unit: 'token',
        attributes: { tool: metricToolName },
        bucketBoundaries: TOOL_OUTPUT_TOKENS_BUCKET_BOUNDARIES,
      });

      return wrapJsonRpcResponse(id, {
        result: {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          isError: false,
        },
      });
    } catch (executionError) {
      this.metricsService.recordHistogram({
        key: MetricsKeys.McpToolExecutionDurationMs,
        value: performance.now() - executionStartedAt,
        unit: 'ms',
        attributes: { tool: metricToolName },
        bucketBoundaries: TOOL_EXECUTION_DURATION_MS_BUCKET_BOUNDARIES,
      });

      this.metricsService.incrementCounterBy({
        key: MetricsKeys.McpToolExecutionFailed,
        amount: 1,
        attributes: { tool: metricToolName },
      });

      const errorMessage =
        executionError instanceof Error
          ? executionError.message
          : 'Tool execution failed';

      const failedOutput = toFailedToolOutput(
        buildToolFailure({
          code: 'INTERNAL_ERROR',
          message: errorMessage,
          hint: 'This looks like a transient failure. Retry once; if it persists, stop and report it.',
          retryable: true,
          allowedActions: ['retry'],
        }),
      );

      return wrapJsonRpcResponse(id, {
        result: {
          content: [{ type: 'text', text: JSON.stringify(failedOutput) }],
          isError: true,
        },
      });
    }
  }

  handleToolsListing(id: string | number, toolSet: ToolSet) {
    const toolsArray = Object.entries(toolSet)
      .filter(([, def]) => !!def.inputSchema)
      .map(([name, def]) => {
        const toolDefinition = def as McpToolDefinition;
        // Unwrap the AI SDK's jsonSchema wrapper if present
        // The AI SDK serializes schemas as { jsonSchema: {...} } but MCP expects {...} directly
        const inputSchema = unwrapJsonSchema(toolDefinition.inputSchema);

        return {
          name,
          description: toolDefinition.description,
          inputSchema,
          ...(isDefined(toolDefinition.annotations) && {
            annotations: toolDefinition.annotations,
          }),
        };
      });

    return wrapJsonRpcResponse(id, {
      result: {
        tools: toolsArray,
      },
    });
  }
}
