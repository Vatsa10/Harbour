import { Injectable } from '@nestjs/common';

import { isDefined, isValidUuid, resolveInput } from 'twenty-shared/utils';

import { type WorkflowAction } from 'src/modules/workflow/workflow-executor/interfaces/workflow-action.interface';

import { ToolCategory } from 'twenty-shared/ai';
import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { type ToolIndexEntry } from 'src/engine/core-modules/tool-provider/types/tool-index-entry.type';
import { UpdateRecordService } from 'src/engine/core-modules/record-crud/services/update-record.service';
import { ProposalGateService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service';
import { WorkflowCommonWorkspaceService } from 'src/modules/workflow/common/workspace-services/workflow-common.workspace-service';
import {
  WorkflowStepExecutorException,
  WorkflowStepExecutorExceptionCode,
} from 'src/modules/workflow/workflow-executor/exceptions/workflow-step-executor.exception';
import { WorkflowExecutionContextService } from 'src/modules/workflow/workflow-executor/services/workflow-execution-context.service';
import { type WorkflowActionInput } from 'src/modules/workflow/workflow-executor/types/workflow-action-input';
import { type WorkflowActionOutput } from 'src/modules/workflow/workflow-executor/types/workflow-action-output.type';
import { buildWorkflowActorMetadata } from 'src/modules/workflow/workflow-executor/utils/build-workflow-actor-metadata.util';
import { isAiAgentOriginatedWorkflowInput } from 'src/modules/workflow/workflow-executor/utils/detect-ai-agent-step-reference.util';
import { filterValidFieldsInRecord } from 'src/modules/workflow/workflow-executor/utils/filter-valid-fields-in-record.util';
import { formatWorkflowRecordRelationFields } from 'src/modules/workflow/workflow-executor/utils/format-workflow-record-relation-fields.util';
import { findStepOrThrow } from 'src/modules/workflow/workflow-executor/utils/find-step-or-throw.util';
import { resolveRichTextFieldsInRecord } from 'src/modules/workflow/workflow-executor/utils/resolve-rich-text-fields-in-record.util';
import { isWorkflowUpdateRecordAction } from 'src/modules/workflow/workflow-executor/workflow-actions/record-crud/guards/is-workflow-update-record-action.guard';
import { type WorkflowUpdateRecordActionInput } from 'src/modules/workflow/workflow-executor/workflow-actions/record-crud/types/workflow-record-crud-action-input.type';

@Injectable()
export class UpdateRecordWorkflowAction implements WorkflowAction {
  constructor(
    private readonly updateRecordService: UpdateRecordService,
    private readonly workflowExecutionContextService: WorkflowExecutionContextService,
    private readonly workflowCommonWorkspaceService: WorkflowCommonWorkspaceService,
    private readonly proposalGateService: ProposalGateService,
  ) {}

  async execute({
    currentStepId,
    steps,
    context,
    runInfo,
  }: WorkflowActionInput): Promise<WorkflowActionOutput> {
    const step = findStepOrThrow({
      steps,
      stepId: currentStepId,
    });

    if (!isWorkflowUpdateRecordAction(step)) {
      throw new WorkflowStepExecutorException(
        'Step is not an update record action',
        WorkflowStepExecutorExceptionCode.INVALID_STEP_TYPE,
      );
    }

    const { workspaceId } = runInfo;

    const rawInput = step.settings.input as WorkflowUpdateRecordActionInput;

    const objectMetadataInfo =
      await this.workflowCommonWorkspaceService.getObjectMetadataInfo(
        rawInput.objectName,
        workspaceId,
      );

    const inputWithResolvedRichText = {
      ...rawInput,
      objectRecord: resolveRichTextFieldsInRecord(
        rawInput.objectRecord,
        objectMetadataInfo,
        context,
      ),
    };

    const workflowActionInput = resolveInput(
      inputWithResolvedRichText,
      context,
    ) as WorkflowUpdateRecordActionInput;

    if (
      !isDefined(workflowActionInput.objectRecordId) ||
      !isValidUuid(workflowActionInput.objectRecordId) ||
      !isDefined(workflowActionInput.objectName)
    ) {
      throw new WorkflowStepExecutorException(
        'Failed to update: Object record ID and name are required',
        WorkflowStepExecutorExceptionCode.INVALID_STEP_INPUT,
      );
    }

    const {
      formattedRecord: formattedObjectRecord,
      joinColumnNamesByMorphFieldName,
    } = formatWorkflowRecordRelationFields(
      workflowActionInput.objectRecord,
      objectMetadataInfo,
    );

    const filteredObjectRecord = filterValidFieldsInRecord(
      formattedObjectRecord,
      objectMetadataInfo.flatObjectMetadata,
      objectMetadataInfo.flatFieldMetadataMaps,
    );

    const expandedFieldsToUpdate = workflowActionInput.fieldsToUpdate?.flatMap(
      (fieldName) => joinColumnNamesByMorphFieldName[fieldName] ?? [fieldName],
    );

    const filteredFieldsToUpdate = expandedFieldsToUpdate?.filter(
      (fieldName) => fieldName in filteredObjectRecord,
    );

    if (filteredFieldsToUpdate?.length === 0) {
      throw new WorkflowStepExecutorException(
        'Failed to update: No fields to update',
        WorkflowStepExecutorExceptionCode.INVALID_STEP_INPUT,
      );
    }

    const executionContext =
      await this.workflowExecutionContextService.getExecutionContext(runInfo);

    const updatedBy = buildWorkflowActorMetadata(executionContext);

    // B2 (contract-audit.md): a static, human-authored update-record step
    // must keep writing directly — that is not an AI write and the charter
    // does not ask for it to be gated. But when this step's input resolved
    // from an AI-agent step's raw `{{stepId.result}}` output, the write is
    // AI-originated in every sense the Proposal contract cares about, and
    // UpdateRecordService sits below ProposalGateService with nothing
    // between them. Detect the provenance from the RAW (pre-resolveInput)
    // template — see isAiAgentOriginatedWorkflowInput for exactly how, and
    // how an unresolvable reference fails closed (gated).
    if (isAiAgentOriginatedWorkflowInput(rawInput, steps)) {
      const roleId =
        'unionOf' in executionContext.rolePermissionConfig
          ? (executionContext.rolePermissionConfig.unionOf[0] ?? 'workflow')
          : 'workflow';

      const gateContext: ToolProviderContext = {
        workspaceId,
        roleId,
        rolePermissionConfig: executionContext.rolePermissionConfig,
        authContext: executionContext.authContext,
        actorContext: executionContext.initiator,
        // Group every item this workflow run proposes under one thread, the
        // same way ai-chat groups a turn's proposals.
        threadId: runInfo.workflowRunId,
      };

      const gateDescriptor: ToolIndexEntry = {
        name: 'workflow_update_record',
        label: 'Update record (workflow step)',
        description:
          'A workflow update-record step whose input came from an AI agent step.',
        category: ToolCategory.DATABASE_CRUD,
        executionRef: {
          kind: 'database_crud',
          objectNameSingular: workflowActionInput.objectName,
          operation: 'update_one',
        },
      };

      const decision = await this.proposalGateService.evaluate({
        descriptor: gateDescriptor,
        args: {
          id: workflowActionInput.objectRecordId,
          ...filteredObjectRecord,
        },
        context: gateContext,
      });

      if (decision.kind === 'PROPOSED') {
        return { result: decision.output.result };
      }

      if (decision.kind === 'FORBID' || decision.kind === 'CONFIRMATION_REQUIRED') {
        return {
          error:
            decision.failure.message ??
            'This AI-originated update was refused by the write-approval policy.',
        };
      }

      // decision.kind === 'ALLOW': the workspace's write policy is AUTO for
      // this target, so the gate has already authorized this exact write.
      // Fall through to the same UpdateRecordService call a static step
      // takes — the gate, not this branch, decided that was safe.
    }

    const toolOutput = await this.updateRecordService.execute({
      objectName: workflowActionInput.objectName,
      objectRecordId: workflowActionInput.objectRecordId,
      objectRecord: filteredObjectRecord,
      fieldsToUpdate: filteredFieldsToUpdate,
      authContext: executionContext.authContext,
      updatedBy,
      rolePermissionConfig: executionContext.rolePermissionConfig,
    });

    if (!toolOutput.success) {
      return { error: toolOutput.error || toolOutput.message };
    }

    return {
      result: toolOutput.result,
    };
  }
}
