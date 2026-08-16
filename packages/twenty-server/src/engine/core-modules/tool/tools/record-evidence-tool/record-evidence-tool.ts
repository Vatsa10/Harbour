import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { isDefined } from 'twenty-shared/utils';

import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { RecordEvidenceInputZodSchema } from 'src/engine/core-modules/tool/tools/record-evidence-tool/record-evidence-tool.schema';
import { type ToolExecutionContext } from 'src/engine/core-modules/tool/types/tool-execution-context.type';
import { type ToolInput } from 'src/engine/core-modules/tool/types/tool-input.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { type Tool } from 'src/engine/core-modules/tool/types/tool.type';
import { EvidenceRecordingService } from 'src/engine/metadata-modules/ai/ai-research/services/evidence-recording.service';
import { type EvidenceSourceType } from 'src/engine/metadata-modules/ai/ai-research/types/evidence.type';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

@Injectable()
export class RecordEvidenceTool implements Tool {
  private readonly logger = new Logger(RecordEvidenceTool.name);

  description =
    'Write down something you observed about a record, with its source. This does not change the record — it files the observation so a human can see why any later proposal was made. Record evidence before proposing a change, not after.';
  inputSchema = RecordEvidenceInputZodSchema;

  constructor(
    private readonly evidenceRecordingService: EvidenceRecordingService,
    // Resolved through ModuleRef rather than the constructor because
    // AiResearchModule (which provides this tool) does not import
    // RecordCrudModule, and that module file is owned by another change in
    // flight. `strict: false` resolves from the application container, which
    // is safe for a default-scoped provider. Convert this to ordinary
    // constructor injection the moment AiResearchModule can be edited again.
    private readonly moduleRef: ModuleRef,
  ) {}

  // The failure message has always promised this check - "Check that recordId
  // is a real <object> in this workspace and that fieldName exists on it" -
  // and nothing performed it. Evidence could be filed against an arbitrary
  // uuid for an object that does not exist, and a CURRENT fact came out the
  // other side. A citation that points at nothing is worse than no citation:
  // a reviewer reads it as corroboration.
  private async findTargetProblem(params: {
    workspaceId: string;
    objectNameSingular: string;
    recordId: string;
    fieldName: string;
  }): Promise<string | null> {
    const findRecordsService = this.moduleRef.get(FindRecordsService, {
      strict: false,
    });

    // A system auth context, deliberately: this is an existence check for
    // provenance, not a data read on the agent's behalf. It returns only
    // whether the target resolves, and `select` makes the field name part of
    // the query, so an unknown object or field fails here rather than
    // silently producing an unanchored citation.
    const output = await findRecordsService.execute({
      objectName: params.objectNameSingular,
      filter: { id: { eq: params.recordId } },
      limit: 1,
      select: [params.fieldName],
      shouldBuildEffectiveSelectFields: true,
      authContext: buildSystemAuthContext(params.workspaceId),
      rolePermissionConfig: { shouldBypassPermissionChecks: true },
    });

    if (!output.success) {
      return `No such object or field: "${params.objectNameSingular}.${params.fieldName}" could not be resolved in this workspace (${output.error}). Use get_object_metadata / get_field_metadata to find the exact names.`;
    }

    const records = (output.result as { records?: unknown[] } | undefined)
      ?.records;

    if (!isDefined(records) || records.length === 0) {
      return `No ${params.objectNameSingular} with id ${params.recordId} exists in this workspace. Find the record first, then record what you observed about it.`;
    }

    return null;
  }

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
      const targetProblem = await this.findTargetProblem({
        workspaceId: context.workspaceId,
        objectNameSingular,
        recordId,
        fieldName,
      });

      if (isDefined(targetProblem)) {
        return {
          success: false,
          message: 'Could not record the observation',
          error: targetProblem,
        };
      }

      const evidence = await this.evidenceRecordingService.recordEvidence({
        workspaceId: context.workspaceId,
        // threadId correlates an observation to the run that made it. Absent on
        // the ad-hoc chat path, which is legitimate — evidence recorded outside
        // a scheduled run is still evidence.
        runId: context.threadId ?? null,
        objectNameSingular,
        recordId,
        sourceType,
        // The model typed this sourceType, so it buys WEAK whatever it says.
        assertedBy: 'MODEL',
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
