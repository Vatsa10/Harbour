import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { RecordEvidenceInputZodSchema } from 'src/engine/core-modules/tool/tools/record-evidence-tool/record-evidence-tool.schema';
import { type ToolExecutionContext } from 'src/engine/core-modules/tool/types/tool-execution-context.type';
import { type ToolInput } from 'src/engine/core-modules/tool/types/tool-input.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { type Tool } from 'src/engine/core-modules/tool/types/tool.type';
import { EvidenceRecordingService } from 'src/engine/metadata-modules/ai/ai-research/services/evidence-recording.service';
import { type EvidenceSourceType } from 'src/engine/metadata-modules/ai/ai-research/types/evidence.type';

@Injectable()
export class RecordEvidenceTool implements Tool {
  private readonly logger = new Logger(RecordEvidenceTool.name);

  description =
    'Write down something you observed about a record, with its source. This does not change the record — it files the observation so a human can see why any later proposal was made. Record evidence before proposing a change, not after.';
  inputSchema = RecordEvidenceInputZodSchema;

  constructor(
    private readonly evidenceRecordingService: EvidenceRecordingService,
  ) {}

  async execute(
    parameters: ToolInput,
    context: ToolExecutionContext,
  ): Promise<ToolOutput> {
    const {
      objectNameSingular,
      recordId,
      fieldName,
      value,
      sourceType,
      sourceLocator,
      snippet,
      observedAt,
    } = parameters as {
      objectNameSingular: string;
      recordId: string;
      fieldName: string;
      value: unknown;
      sourceType: EvidenceSourceType;
      sourceLocator: string;
      snippet?: string;
      observedAt?: string;
    };

    try {
      const evidence = await this.evidenceRecordingService.recordEvidence({
        workspaceId: context.workspaceId,
        // threadId correlates an observation to the run that made it. Absent on
        // the ad-hoc chat path, which is legitimate — evidence recorded outside
        // a scheduled run is still evidence.
        runId: context.threadId ?? null,
        objectNameSingular,
        recordId,
        sourceType,
        sourceLocator,
        // The extractor is the tool, not the model: two runs of different
        // models through this path produce comparable provenance.
        extractor: 'record_evidence',
        observedAt: isDefined(observedAt) ? new Date(observedAt) : undefined,
        payload: { fieldName, value, snippet },
      });

      return {
        success: true,
        message: `Observation recorded for ${objectNameSingular}.${fieldName}. Any change to the record still needs a proposal and human approval.`,
        result: {
          evidenceId: evidence.id,
          strength: evidence.strength,
          fieldName,
        },
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown error recording evidence';

      this.logger.warn(
        `record_evidence failed for ${objectNameSingular}:${recordId} — ${message}`,
      );

      return {
        success: false,
        message: 'Could not record the observation',
        error: `${message}. Check that recordId is a real ${objectNameSingular} in this workspace and that fieldName exists on it.`,
      };
    }
  }
}
