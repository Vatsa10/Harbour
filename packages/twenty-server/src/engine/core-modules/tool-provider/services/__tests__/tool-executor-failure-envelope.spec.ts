import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { KeyValuePairService } from 'src/engine/core-modules/key-value-pair/key-value-pair.service';
import { LogicFunctionExecutorService } from 'src/engine/core-modules/logic-function/logic-function-executor/logic-function-executor.service';
import { CreateManyRecordsService } from 'src/engine/core-modules/record-crud/services/create-many-records.service';
import { CreateRecordService } from 'src/engine/core-modules/record-crud/services/create-record.service';
import { DeleteManyRecordsService } from 'src/engine/core-modules/record-crud/services/delete-many-records.service';
import { DeleteRecordService } from 'src/engine/core-modules/record-crud/services/delete-record.service';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { GroupByRecordsService } from 'src/engine/core-modules/record-crud/services/group-by-records.service';
import { UpdateManyRecordsService } from 'src/engine/core-modules/record-crud/services/update-many-records.service';
import { UpdateRecordService } from 'src/engine/core-modules/record-crud/services/update-record.service';
import { UpsertManyRecordsService } from 'src/engine/core-modules/record-crud/services/upsert-many-records.service';
import { TOOL_PROVIDERS } from 'src/engine/core-modules/tool-provider/constants/tool-providers.token';
import { ToolExecutorService } from 'src/engine/core-modules/tool-provider/services/tool-executor.service';
import { NotificationService } from 'src/engine/core-modules/notification/services/notification.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import { FactService } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
import { AiWritePolicyService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/ai-write-policy.service';
import { ProposalGateService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service';
import { ProposalSupersessionService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-supersession.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

// Real seam: ToolExecutorService -> real ProposalGateService -> real
// AiWritePolicyService. Only the persistence edges are stubbed, so the gate's
// own classification and the failure envelope are both exercised for real.
const context = {
  workspaceId: 'workspace-1',
  threadId: null,
  rolePermissionConfig: { unionOf: ['role-1'] },
  authContext: { type: 'system', workspace: { id: 'workspace-1' } },
} as never;

const buildStaticDescriptor = (toolId: string) =>
  ({
    name: toolId,
    category: 'messaging',
    executionRef: { kind: 'static', toolId },
  }) as never;

describe('ToolExecutorService failure envelope', () => {
  let service: ToolExecutorService;

  const keyValuePairService = { get: jest.fn(), set: jest.fn() };
  const proposalRepository = { findOne: jest.fn(), save: jest.fn() };
  // `find` backs the gate's retry-dedupe lookup; the gate calls it on every
  // PROPOSE decision, so a stub without it turns the denylist guard below into
  // a TypeError instead of an assertion.
  const proposalItemRepository = { save: jest.fn(), find: jest.fn() };
  const provider = {
    category: 'messaging',
    isAvailable: jest.fn().mockResolvedValue(true),
    executeStaticTool: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    provider.isAvailable.mockResolvedValue(true);
    proposalRepository.findOne.mockResolvedValue(null);
    proposalRepository.save.mockResolvedValue({ id: 'proposal-1' });
    proposalItemRepository.save.mockResolvedValue({ id: 'proposal-item-1' });
    proposalItemRepository.find.mockResolvedValue([]);

    const stub = { execute: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ToolExecutorService,
        ProposalGateService,
        AiWritePolicyService,
        {
          provide: ProposalSupersessionService,
          useValue: { supersedeOverlappingItems: jest.fn() },
        },
        {
          provide: NotificationService,
          useValue: { raise: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: TOOL_PROVIDERS, useValue: [provider] },
        { provide: KeyValuePairService, useValue: keyValuePairService },
        {
          provide: getRepositoryToken(ProposalEntity),
          useValue: proposalRepository,
        },
        {
          provide: getRepositoryToken(ProposalItemEntity),
          useValue: proposalItemRepository,
        },
        { provide: FindRecordsService, useValue: stub },
        {
          provide: FactService,
          useValue: { findCurrentFactIdsForFields: jest.fn(() => []) },
        },
        { provide: GroupByRecordsService, useValue: stub },
        { provide: CreateRecordService, useValue: stub },
        { provide: CreateManyRecordsService, useValue: stub },
        { provide: UpdateRecordService, useValue: stub },
        { provide: UpdateManyRecordsService, useValue: stub },
        { provide: UpsertManyRecordsService, useValue: stub },
        { provide: DeleteRecordService, useValue: stub },
        { provide: DeleteManyRecordsService, useValue: stub },
        { provide: LogicFunctionExecutorService, useValue: stub },
        {
          provide: WorkspaceCacheService,
          useValue: { getOrRecompute: jest.fn() },
        },
        {
          provide: getRepositoryToken(UserEntity),
          useValue: { findOne: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ToolExecutorService>(ToolExecutorService);
  });

  it('should return a recoverable FORBIDDEN_BY_POLICY envelope when the real policy forbids the tool', async () => {
    keyValuePairService.get.mockResolvedValue([
      { value: { default: 'PROPOSE', overrides: { send_email: 'FORBID' } } },
    ]);

    const result = await service.dispatch(
      buildStaticDescriptor('send_email'),
      { to: 'a@b.com', subject: 'hi', body: 'hi' },
      context,
    );

    expect(provider.executeStaticTool).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.failure?.code).toBe('FORBIDDEN_BY_POLICY');
    expect(result.failure?.retryable).toBe(false);
    expect(result.failure?.hint.length).toBeGreaterThan(0);
    expect(result.failure?.allowedActions).toEqual([
      'ask_admin_to_change_policy',
    ]);
    // Legacy consumers that render only `error` must still get the recovery
    // path, not a bare "something went wrong".
    expect(result.error).toContain('send_email');
    expect(result.error).toContain('Ask a workspace admin');
  });

  it('should still gate an unenumerated write tool rather than executing it', async () => {
    keyValuePairService.get.mockResolvedValue([]);

    const result = await service.dispatch(
      buildStaticDescriptor('obliterate_workspace'),
      { confirm: true },
      context,
    );

    expect(provider.executeStaticTool).not.toHaveBeenCalled();
    expect(proposalItemRepository.save).toHaveBeenCalledTimes(1);
    // A proposed write reports success so the agent does not retry it.
    expect(result.success).toBe(true);
    expect(result.failure).toBeUndefined();
    expect(result.result).toEqual({
      proposalId: 'proposal-1',
      proposalItemId: 'proposal-item-1',
      status: 'PENDING',
    });
  });

  it('should return a PERMISSION_DENIED envelope when the provider is unavailable', async () => {
    keyValuePairService.get.mockResolvedValue([]);
    provider.isAvailable.mockResolvedValue(false);

    const result = await service.dispatch(
      buildStaticDescriptor('search_help_center'),
      {},
      context,
    );

    expect(provider.executeStaticTool).not.toHaveBeenCalled();
    expect(result.failure?.code).toBe('PERMISSION_DENIED');
    expect(result.failure?.allowedActions).toEqual(['get_tool_catalog']);
    expect(result.error).toContain('get_tool_catalog');
  });
});
