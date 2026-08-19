import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';
import {
  buildToolInputJsonSchema,
  DEFAULT_TOOL_INPUT_SCHEMA,
} from 'twenty-shared/logic-function';

import { type GenerateDescriptorOptions } from 'src/engine/core-modules/tool-provider/interfaces/generate-descriptor-options.type';
import { type ToolProvider } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider.interface';
import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';

import { ToolCategory } from 'twenty-shared/ai';
import { type ToolDescriptor } from 'src/engine/core-modules/tool-provider/types/tool-descriptor.type';
import { type ToolIndexEntry } from 'src/engine/core-modules/tool-provider/types/tool-index-entry.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { LogicFunctionExecutorService } from 'src/engine/core-modules/logic-function/logic-function-executor/logic-function-executor.service';
import {
  buildToolFailure,
  toFailedToolOutput,
} from 'src/engine/core-modules/tool/utils/build-tool-failure.util';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { type FlatLogicFunction } from 'src/engine/metadata-modules/logic-function/types/flat-logic-function.type';

@Injectable()
export class LogicFunctionToolProvider implements ToolProvider {
  readonly category = ToolCategory.LOGIC_FUNCTION;

  constructor(
    private readonly flatEntityMapsCacheService: WorkspaceManyOrAllFlatEntityMapsCacheService,
    private readonly logicFunctionExecutorService: LogicFunctionExecutorService,
  ) {}

  async isAvailable(_context: ToolProviderContext): Promise<boolean> {
    return true;
  }

  // Logic function tools emit `executionRef.kind === 'logic_function'`
  // descriptors and are dispatched inline by ToolExecutorService
  // (dispatchLogicFunction). This method is the *replay* path instead:
  // ProposalGateService now routes every logic_function tool through the
  // gate as a STATIC_TOOL-shaped proposal item, recording the
  // logicFunctionId in `toolId` (see proposal-gate.service.ts's
  // `logic_function` branch). ProposalExecutionService.applyStaticTool
  // calls back in here on approval with that same id as `toolName`, so this
  // executes the approved logic function rather than throwing.
  async executeStaticTool(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolProviderContext,
  ): Promise<ToolOutput> {
    const result = await this.logicFunctionExecutorService.execute({
      logicFunctionId: toolName,
      workspaceId: context.workspaceId,
      payload: args,
    });

    if (result.error) {
      return toFailedToolOutput(
        buildToolFailure({
          code: 'INTERNAL_ERROR',
          message: `Logic function execution failed: ${result.error.errorMessage}`,
          hint: 'Check the arguments against the tool schema and try once more; if it fails again, report the error to the user.',
          retryable: true,
        }),
      );
    }

    return {
      success: true,
      message: 'Logic function executed successfully',
      result: result.data ?? undefined,
    };
  }

  async generateDescriptors(
    context: ToolProviderContext,
    options?: GenerateDescriptorOptions,
  ): Promise<(ToolIndexEntry | ToolDescriptor)[]> {
    const includeSchemas = options?.includeSchemas ?? true;

    const { flatLogicFunctionMaps, flatObjectMetadataMaps } =
      await this.flatEntityMapsCacheService.getOrRecomputeManyOrAllFlatEntityMaps(
        {
          workspaceId: context.workspaceId,
          flatMapsKeys: ['flatLogicFunctionMaps', 'flatObjectMetadataMaps'],
        },
      );

    const resolveObjectLabel = (objectUniversalIdentifier: string) =>
      flatObjectMetadataMaps.byUniversalIdentifier[objectUniversalIdentifier]
        ?.labelSingular;

    const logicFunctionsWithSchema = Object.values(
      flatLogicFunctionMaps.byUniversalIdentifier,
    ).filter(
      (fn): fn is FlatLogicFunction =>
        isDefined(fn) &&
        isDefined(fn.toolTriggerSettings) &&
        fn.deletedAt === null,
    );

    const descriptors: (ToolIndexEntry | ToolDescriptor)[] = [];

    for (const logicFunction of logicFunctionsWithSchema) {
      const toolName = this.buildLogicFunctionToolName(logicFunction.name);

      const base: ToolIndexEntry = {
        name: toolName,
        label: logicFunction.name,
        description:
          logicFunction.description ||
          `Execute the ${logicFunction.name} logic function`,
        category: ToolCategory.LOGIC_FUNCTION,
        executionRef: {
          kind: 'logic_function',
          logicFunctionId: logicFunction.id,
        },
      };

      if (includeSchemas) {
        descriptors.push({
          ...base,
          inputSchema: isDefined(logicFunction.toolTriggerSettings?.inputSchema)
            ? (buildToolInputJsonSchema(
                logicFunction.toolTriggerSettings.inputSchema,
                resolveObjectLabel,
              ) as object)
            : DEFAULT_TOOL_INPUT_SCHEMA,
        });
      } else {
        descriptors.push(base);
      }
    }

    return descriptors;
  }

  private buildLogicFunctionToolName(functionName: string): string {
    return `app_${functionName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')}`;
  }
}
