import { Injectable } from '@nestjs/common';

import { FieldActorSource } from 'searm-shared/types';

import { CreateAgentTaskInputZodSchema } from 'src/engine/core-modules/tool/tools/create-agent-task-tool/create-agent-task-tool.schema';
import { type ToolExecutionContext } from 'src/engine/core-modules/tool/types/tool-execution-context.type';
import { type ToolInput } from 'src/engine/core-modules/tool/types/tool-input.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { type Tool } from 'src/engine/core-modules/tool/types/tool.type';
import { AgentTaskService } from 'src/engine/metadata-modules/ai/ai-research/services/agent-task.service';
import { ResearchAgentService } from 'src/engine/metadata-modules/ai/ai-research/services/research-agent.service';

@Injectable()
export class CreateAgentTaskTool implements Tool {
  description =
    'Schedule durable background research on a company or person record. The research runs later, records evidence, and proposes any change for human approval. This does not modify the record and does not run the research now.';
  inputSchema = CreateAgentTaskInputZodSchema;

  constructor(
    private readonly agentTaskService: AgentTaskService,
    private readonly researchAgentService: ResearchAgentService,
  ) {}

  async execute(
    parameters: ToolInput,
    context: ToolExecutionContext,
  ): Promise<ToolOutput> {
    const { objectNameSingular, recordId, reason, priority, budget } =
      parameters as {
        objectNameSingular: string;
        recordId: string;
        reason: string;
        priority?: number;
        budget?: number;
      };

    let agentId: string;

    try {
      // Owner Decision 4: one seeded agent per workspace runs scheduled
      // research. Resolving it here is what keeps agentId off the model's
      // input schema — an agent must never get to pick which agent runs next.
      agentId = await this.researchAgentService.resolveResearchAgentId(
        context.workspaceId,
      );
    } catch (error) {
      return {
        success: false,
        message: 'No research agent is available in this workspace',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    const task = await this.agentTaskService.createTask({
      workspaceId: context.workspaceId,
      objectNameSingular,
      recordId,
      agentId,
      reason,
      priority,
      budget,
      // Same (record, reason) from a re-fired trigger reuses the open task
      // rather than queueing the same research twice.
      idempotencyKey: `tool:${objectNameSingular}:${recordId}:${reason}`,
      // ToolExecutionContext carries no actor (five fields, none of them an
      // actor), so the actor is assembled here. Contract 5 asks the audit
      // entry to distinguish principals, and 'AI agent' distinguishes nothing
      // — the id of the agent that scheduled the work is known four lines up,
      // and ActorMetadata.context is typed to `provider` only, so `name` is
      // where it can go.
      createdByActor: {
        source: FieldActorSource.AGENT,
        workspaceMemberId: null,
        name: `AI agent ${agentId}`,
        context: {},
      },
    });

    return {
      success: true,
      message: `Scheduled research on ${objectNameSingular} ${recordId}.`,
      result: { taskId: task.id, status: task.status },
    };
  }
}
