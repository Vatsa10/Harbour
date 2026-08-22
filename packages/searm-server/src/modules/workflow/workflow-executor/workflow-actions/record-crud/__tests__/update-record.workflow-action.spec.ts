import { WorkflowActionType } from 'searm-shared/workflow';

import { UpdateRecordService } from 'src/engine/core-modules/record-crud/services/update-record.service';
import { ProposalGateService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service';
import { WorkflowCommonWorkspaceService } from 'src/modules/workflow/common/workspace-services/workflow-common.workspace-service';
import { WorkflowExecutionContextService } from 'src/modules/workflow/workflow-executor/services/workflow-execution-context.service';
import { type WorkflowAction } from 'src/modules/workflow/workflow-executor/workflow-actions/types/workflow-action.type';
import { UpdateRecordWorkflowAction } from 'src/modules/workflow/workflow-executor/workflow-actions/record-crud/update-record.workflow-action';

// These three utils need a real flat-metadata graph to do anything
// interesting; here they only have to pass the record through unchanged so
// the test can focus on the B2 routing decision (gate vs. direct write),
// not on field/relation formatting, which is exercised elsewhere.
jest.mock(
  'src/modules/workflow/workflow-executor/utils/filter-valid-fields-in-record.util',
  () => ({
    filterValidFieldsInRecord: (record: Record<string, unknown>) => record,
  }),
);
jest.mock(
  'src/modules/workflow/workflow-executor/utils/format-workflow-record-relation-fields.util',
  () => ({
    formatWorkflowRecordRelationFields: (record: Record<string, unknown>) => ({
      formattedRecord: record,
      joinColumnNamesByMorphFieldName: {},
    }),
  }),
);
jest.mock(
  'src/modules/workflow/workflow-executor/utils/resolve-rich-text-fields-in-record.util',
  () => ({
    resolveRichTextFieldsInRecord: (record: Record<string, unknown>) => record,
  }),
);

const RECORD_ID = '20202020-1111-4111-8111-111111111111';

const buildUpdateRecordStep = (
  objectRecord: Record<string, unknown>,
): WorkflowAction =>
  ({
    id: 'update-step',
    type: WorkflowActionType.UPDATE_RECORD,
    name: 'Update',
    valid: true,
    settings: {
      outputSchema: {},
      errorHandlingOptions: {
        retryOnFailure: { value: false },
        continueOnFailure: { value: false },
      },
      input: {
        objectName: 'person',
        objectRecordId: RECORD_ID,
        objectRecord,
      },
    },
  }) as WorkflowAction;

const buildAiAgentStep = (): WorkflowAction =>
  ({
    id: 'ai-step',
    type: WorkflowActionType.AI_AGENT,
    name: 'Agent',
    valid: true,
    settings: {
      outputSchema: {},
      errorHandlingOptions: {
        retryOnFailure: { value: false },
        continueOnFailure: { value: false },
      },
      input: { agentId: 'agent-1', prompt: 'do the thing' },
    },
  }) as WorkflowAction;

const buildFormStep = (): WorkflowAction =>
  ({
    id: 'form-step',
    type: WorkflowActionType.FORM,
    name: 'Form',
    valid: true,
    settings: {
      outputSchema: {},
      errorHandlingOptions: {
        retryOnFailure: { value: false },
        continueOnFailure: { value: false },
      },
      input: {},
    },
  }) as WorkflowAction;

describe('UpdateRecordWorkflowAction (B2: AI-agent-output provenance gate)', () => {
  let action: UpdateRecordWorkflowAction;
  let updateRecordService: { execute: jest.Mock };
  let workflowExecutionContextService: { getExecutionContext: jest.Mock };
  let workflowCommonWorkspaceService: { getObjectMetadataInfo: jest.Mock };
  let proposalGateService: { evaluate: jest.Mock };

  const runInfo = { workflowRunId: 'run-1', workspaceId: 'workspace-1' };

  beforeEach(() => {
    jest.clearAllMocks();

    updateRecordService = {
      execute: jest.fn().mockResolvedValue({
        success: true,
        message: 'ok',
        result: { id: RECORD_ID },
      }),
    };
    workflowExecutionContextService = {
      getExecutionContext: jest.fn().mockResolvedValue({
        isActingOnBehalfOfUser: false,
        initiator: { source: 'WORKFLOW', name: 'Workflow', context: {} },
        rolePermissionConfig: { unionOf: ['role-1'] },
        authContext: { type: 'system' },
      }),
    };
    workflowCommonWorkspaceService = {
      getObjectMetadataInfo: jest.fn().mockResolvedValue({
        flatObjectMetadata: { fieldIds: [] },
        flatFieldMetadataMaps: {},
      }),
    };
    proposalGateService = { evaluate: jest.fn() };

    action = new UpdateRecordWorkflowAction(
      updateRecordService as unknown as UpdateRecordService,
      workflowExecutionContextService as unknown as WorkflowExecutionContextService,
      workflowCommonWorkspaceService as unknown as WorkflowCommonWorkspaceService,
      proposalGateService as unknown as ProposalGateService,
    );
  });

  it('should write directly, without consulting the gate, when the input is human-authored static text', async () => {
    const step = buildUpdateRecordStep({ jobTitle: 'VP Sales' });

    const output = await action.execute({
      currentStepId: 'update-step',
      steps: [step],
      context: {},
      runInfo,
    });

    expect(proposalGateService.evaluate).not.toHaveBeenCalled();
    expect(updateRecordService.execute).toHaveBeenCalledTimes(1);
    expect(output.error).toBeUndefined();
  });

  it('should write directly when the input only references the trigger payload', async () => {
    const step = buildUpdateRecordStep({ jobTitle: '{{trigger.jobTitle}}' });

    const output = await action.execute({
      currentStepId: 'update-step',
      steps: [step],
      context: { trigger: { jobTitle: 'VP Sales' } },
      runInfo,
    });

    expect(proposalGateService.evaluate).not.toHaveBeenCalled();
    expect(updateRecordService.execute).toHaveBeenCalledTimes(1);
    expect(output.error).toBeUndefined();
  });

  it('should route through ProposalGateService, never calling UpdateRecordService directly, when the input resolves from an AI-agent step output', async () => {
    const aiStep = buildAiAgentStep();
    const step = buildUpdateRecordStep({ jobTitle: '{{ai-step.result}}' });

    proposalGateService.evaluate.mockResolvedValue({
      kind: 'PROPOSED',
      output: {
        success: true,
        message: 'Change proposed and awaiting human approval.',
        result: { proposalId: 'proposal-1', proposalItemId: 'item-1' },
      },
    });

    const output = await action.execute({
      currentStepId: 'update-step',
      steps: [step, aiStep],
      context: { 'ai-step': { result: 'VP Sales' } },
      runInfo,
    });

    expect(proposalGateService.evaluate).toHaveBeenCalledTimes(1);
    expect(updateRecordService.execute).not.toHaveBeenCalled();
    expect(output.result).toMatchObject({ proposalId: 'proposal-1' });
    expect(output.error).toBeUndefined();
  });

  it('should refuse the write, never calling UpdateRecordService, when the gate FORBIDs an AI-agent-originated write', async () => {
    const aiStep = buildAiAgentStep();
    const step = buildUpdateRecordStep({ jobTitle: '{{ai-step.result}}' });

    proposalGateService.evaluate.mockResolvedValue({
      kind: 'FORBID',
      failure: { message: 'Refused by write policy', code: 'FORBIDDEN' },
    });

    const output = await action.execute({
      currentStepId: 'update-step',
      steps: [step, aiStep],
      context: { 'ai-step': { result: 'VP Sales' } },
      runInfo,
    });

    expect(updateRecordService.execute).not.toHaveBeenCalled();
    expect(output.error).toBe('Refused by write policy');
  });

  it('should gate rather than write directly when a referenced step id is not present in `steps` at all (ambiguous provenance fails closed)', async () => {
    const step = buildUpdateRecordStep({
      jobTitle: '{{some-unknown-step.result}}',
    });

    proposalGateService.evaluate.mockResolvedValue({
      kind: 'FORBID',
      failure: { message: 'Refused', code: 'FORBIDDEN' },
    });

    await action.execute({
      currentStepId: 'update-step',
      steps: [step],
      context: { 'some-unknown-step': { result: 'VP Sales' } },
      runInfo,
    });

    expect(proposalGateService.evaluate).toHaveBeenCalledTimes(1);
    expect(updateRecordService.execute).not.toHaveBeenCalled();
  });

  it('should write directly when the referenced step is a non-AI step (e.g. a FORM step)', async () => {
    const formStep = buildFormStep();
    const step = buildUpdateRecordStep({ jobTitle: '{{form-step.answer}}' });

    await action.execute({
      currentStepId: 'update-step',
      steps: [step, formStep],
      context: { 'form-step': { answer: 'VP Sales' } },
      runInfo,
    });

    expect(proposalGateService.evaluate).not.toHaveBeenCalled();
    expect(updateRecordService.execute).toHaveBeenCalledTimes(1);
  });
});
