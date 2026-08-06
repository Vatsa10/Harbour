import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

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
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { ProposalGateService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

const context = {
  workspaceId: 'workspace-1',
  roleId: 'role-1',
  rolePermissionConfig: { unionOf: ['role-1'] },
  authContext: { type: 'system', workspace: { id: 'workspace-1' } },
} as never;

const updateDescriptor = {
  name: 'update_person',
  category: 'database',
  executionRef: {
    kind: 'database_crud',
    objectNameSingular: 'person',
    operation: 'update_one',
  },
} as never;

const findDescriptor = {
  name: 'find_person',
  category: 'database',
  executionRef: {
    kind: 'database_crud',
    objectNameSingular: 'person',
    operation: 'find_many',
  },
} as never;

describe('ToolExecutorService gating', () => {
  let service: ToolExecutorService;

  const gateService = { evaluate: jest.fn() };
  const updateRecordService = { execute: jest.fn() };
  const findRecordsService = { execute: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    updateRecordService.execute.mockResolvedValue({
      success: true,
      message: 'updated',
    });
    findRecordsService.execute.mockResolvedValue({
      success: true,
      message: 'found',
    });

    const stub = { execute: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ToolExecutorService,
        { provide: TOOL_PROVIDERS, useValue: [] },
        { provide: ProposalGateService, useValue: gateService },
        { provide: UpdateRecordService, useValue: updateRecordService },
        { provide: FindRecordsService, useValue: findRecordsService },
        { provide: GroupByRecordsService, useValue: stub },
        { provide: CreateRecordService, useValue: stub },
        { provide: CreateManyRecordsService, useValue: stub },
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

  it('should execute the write when the gate allows it', async () => {
    gateService.evaluate.mockResolvedValue({ kind: 'ALLOW' });

    await service.dispatch(
      updateDescriptor,
      { id: 'record-1', jobTitle: 'New title' },
      context,
    );

    expect(updateRecordService.execute).toHaveBeenCalled();
  });

  it('should not execute the write when the gate proposes it', async () => {
    const proposedOutput = {
      success: true,
      message: 'Change proposed and awaiting human approval.',
      result: { proposalId: 'proposal-1' },
    };

    gateService.evaluate.mockResolvedValue({
      kind: 'PROPOSED',
      output: proposedOutput,
    });

    const result = await service.dispatch(
      updateDescriptor,
      { id: 'record-1', jobTitle: 'New title' },
      context,
    );

    expect(updateRecordService.execute).not.toHaveBeenCalled();
    expect(result).toEqual(proposedOutput);
  });

  it('should return an error output when the gate forbids the write', async () => {
    gateService.evaluate.mockResolvedValue({
      kind: 'FORBID',
      message: 'Not permitted',
    });

    const result = await service.dispatch(
      updateDescriptor,
      { id: 'record-1', jobTitle: 'New title' },
      context,
    );

    expect(updateRecordService.execute).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toBe('Not permitted');
  });

  it('should still execute reads', async () => {
    gateService.evaluate.mockResolvedValue({ kind: 'ALLOW' });

    await service.dispatch(findDescriptor, {}, context);

    expect(findRecordsService.execute).toHaveBeenCalled();
  });
});
