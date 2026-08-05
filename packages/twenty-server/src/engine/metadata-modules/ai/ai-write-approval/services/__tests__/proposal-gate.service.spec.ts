import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import { AiWritePolicyService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/ai-write-policy.service';
import { ProposalGateService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service';

const context = {
  workspaceId: 'workspace-1',
  roleId: 'role-1',
  rolePermissionConfig: { unionOf: ['role-1'] },
  threadId: 'thread-1',
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

describe('ProposalGateService', () => {
  let service: ProposalGateService;

  const policyService = {
    getPolicy: jest.fn(),
    resolveMode: jest.fn(),
  };
  const findRecordsService = { execute: jest.fn() };
  const proposalRepository = { findOne: jest.fn(), save: jest.fn() };
  const proposalItemRepository = { save: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    policyService.getPolicy.mockResolvedValue({
      default: 'PROPOSE',
      overrides: {},
    });
    proposalRepository.findOne.mockResolvedValue(null);
    proposalRepository.save.mockImplementation(async (entity) => ({
      ...entity,
      id: 'proposal-1',
    }));
    proposalItemRepository.save.mockImplementation(async (entity) => ({
      ...entity,
      id: 'item-1',
    }));
    findRecordsService.execute.mockResolvedValue({
      success: true,
      message: 'ok',
      result: { records: [{ id: 'record-1', jobTitle: 'Old title' }] },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProposalGateService,
        { provide: AiWritePolicyService, useValue: policyService },
        { provide: FindRecordsService, useValue: findRecordsService },
        {
          provide: getRepositoryToken(ProposalEntity),
          useValue: proposalRepository,
        },
        {
          provide: getRepositoryToken(ProposalItemEntity),
          useValue: proposalItemRepository,
        },
      ],
    }).compile();

    service = module.get<ProposalGateService>(ProposalGateService);
  });

  it('should allow reads without consulting the policy', async () => {
    const decision = await service.evaluate({
      descriptor: findDescriptor,
      args: {},
      context,
    });

    expect(decision.kind).toBe('ALLOW');
    expect(policyService.getPolicy).not.toHaveBeenCalled();
  });

  it('should allow a write when the policy resolves to AUTO', async () => {
    policyService.resolveMode.mockReturnValue('AUTO');

    const decision = await service.evaluate({
      descriptor: updateDescriptor,
      args: { id: 'record-1', jobTitle: 'New title' },
      context,
    });

    expect(decision.kind).toBe('ALLOW');
    expect(proposalItemRepository.save).not.toHaveBeenCalled();
  });

  it('should propose a write when the policy resolves to PROPOSE', async () => {
    policyService.resolveMode.mockReturnValue('PROPOSE');

    const decision = await service.evaluate({
      descriptor: updateDescriptor,
      args: { id: 'record-1', jobTitle: 'New title' },
      context,
    });

    expect(decision.kind).toBe('PROPOSED');
    expect(proposalItemRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'UPDATE_RECORD',
        objectNameSingular: 'person',
        recordId: 'record-1',
        payload: { jobTitle: 'New title' },
      }),
    );
  });

  it('should capture the current field values as the baseline', async () => {
    policyService.resolveMode.mockReturnValue('PROPOSE');

    await service.evaluate({
      descriptor: updateDescriptor,
      args: { id: 'record-1', jobTitle: 'New title' },
      context,
    });

    expect(proposalItemRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ baseline: { jobTitle: 'Old title' } }),
    );
  });

  it('should return a success-shaped output so the agent does not retry', async () => {
    policyService.resolveMode.mockReturnValue('PROPOSE');

    const decision = await service.evaluate({
      descriptor: updateDescriptor,
      args: { id: 'record-1', jobTitle: 'New title' },
      context,
    });

    if (decision.kind !== 'PROPOSED') {
      throw new Error('expected a proposed decision');
    }

    expect(decision.output.success).toBe(true);
    expect(decision.output.message).toContain('awaiting human approval');
  });

  it('should reuse one pending proposal for every call in the same thread', async () => {
    policyService.resolveMode.mockReturnValue('PROPOSE');
    proposalRepository.findOne.mockResolvedValue({ id: 'proposal-existing' });

    await service.evaluate({
      descriptor: updateDescriptor,
      args: { id: 'record-1', jobTitle: 'New title' },
      context,
    });

    expect(proposalRepository.save).not.toHaveBeenCalled();
    expect(proposalItemRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: 'proposal-existing' }),
    );
  });

  it('should resolve policy keys from the data envelope of a bulk update', async () => {
    policyService.resolveMode.mockReturnValue('PROPOSE');

    const updateManyDescriptor = {
      name: 'update_many_person',
      category: 'database',
      executionRef: {
        kind: 'database_crud',
        objectNameSingular: 'person',
        operation: 'update_many',
      },
    } as never;

    await service.evaluate({
      descriptor: updateManyDescriptor,
      args: { filter: { city: { eq: 'Berlin' } }, data: { jobTitle: 'Lead' } },
      context,
    });

    expect(policyService.resolveMode).toHaveBeenCalledWith(expect.anything(), [
      'person',
      'person.jobTitle',
    ]);
  });

  it('should forbid a write when the policy resolves to FORBID', async () => {
    policyService.resolveMode.mockReturnValue('FORBID');

    const decision = await service.evaluate({
      descriptor: updateDescriptor,
      args: { id: 'record-1', jobTitle: 'New title' },
      context,
    });

    expect(decision.kind).toBe('FORBID');
    expect(proposalItemRepository.save).not.toHaveBeenCalled();
  });
});
