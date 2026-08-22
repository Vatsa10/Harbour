import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { FieldActorSource } from 'searm-shared/types';

import { KeyValuePairService } from 'src/engine/core-modules/key-value-pair/key-value-pair.service';
import { FactService } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import { AiWritePolicyService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/ai-write-policy.service';
import { NotificationService } from 'src/engine/core-modules/notification/services/notification.service';
import { ProposalSupersessionService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-supersession.service';
import { ProposalCreationService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-creation.service';
import { type AiWritePolicy } from 'src/engine/metadata-modules/ai/ai-write-approval/types/ai-write-policy.type';
import { type ExtractionProposalItemInput } from 'src/engine/metadata-modules/ai/ai-write-approval/types/extraction-proposal.type';
import {
  ProposalActionType,
  ProposalItemStatus,
  ProposalStatus,
} from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';

const createdByActor = {
  source: FieldActorSource.EMAIL,
  workspaceMemberId: null,
  name: 'Message extraction',
  context: {},
};

const jobTitleItem: ExtractionProposalItemInput = {
  actionType: ProposalActionType.UPDATE_RECORD,
  objectNameSingular: 'person',
  recordId: 'record-1',
  payload: { jobTitle: 'VP Sales' },
  baseline: { jobTitle: 'Sales Manager' },
};

const phoneItem: ExtractionProposalItemInput = {
  actionType: ProposalActionType.UPDATE_RECORD,
  objectNameSingular: 'person',
  recordId: 'record-2',
  payload: { phone: '+1 555 0100' },
  baseline: { phone: null },
};

describe('ProposalCreationService', () => {
  let service: ProposalCreationService;

  // The policy service is REAL here, driven only through a mocked
  // key-value store. Mocking resolveMode would let this service build
  // override keys the policy can never match and the test would still pass.
  const keyValuePairService = { get: jest.fn(), set: jest.fn() };
  // Supersession is covered by its own spec; here it only has to be
  // reachable, so the collaborator is stubbed.
  const proposalSupersessionService = {
    supersedeOverlappingItems: jest
      .fn()
      .mockResolvedValue({ supersededItemIds: [], supersededProposalIds: [] }),
  };
  const factService = { findCurrentFactIdsForFields: jest.fn() };
  const notificationService = { raise: jest.fn().mockResolvedValue(null) };
  const proposalRepository = { findOne: jest.fn(), save: jest.fn() };
  const proposalItemRepository = { save: jest.fn(), find: jest.fn() };

  const setPolicy = (policy: AiWritePolicy) => {
    keyValuePairService.get.mockResolvedValue([{ value: policy }]);
  };

  const createFromExtraction = (
    items: ExtractionProposalItemInput[],
    sourceKey = 'ingestion:message:msg-1',
  ) =>
    service.createFromExtraction({
      workspaceId: 'workspace-1',
      sourceKey,
      reason: 'Extracted from an email',
      createdByActor,
      items,
    });

  beforeEach(async () => {
    jest.clearAllMocks();

    setPolicy({ default: 'PROPOSE', overrides: {} });
    proposalRepository.findOne.mockResolvedValue(null);
    factService.findCurrentFactIdsForFields.mockResolvedValue(['fact-1']);
    proposalRepository.save.mockImplementation(async (entity) => ({
      ...entity,
      id: 'proposal-1',
    }));
    proposalItemRepository.save.mockImplementation(async (entity) => ({
      ...entity,
      id: 'item-1',
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProposalCreationService,
        AiWritePolicyService,
        { provide: KeyValuePairService, useValue: keyValuePairService },
        { provide: FactService, useValue: factService },
        {
          provide: ProposalSupersessionService,
          useValue: proposalSupersessionService,
        },
        {
          provide: NotificationService,
          useValue: notificationService,
        },
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

    service = module.get<ProposalCreationService>(ProposalCreationService);
  });

  it('should return null and write nothing when there are no items', async () => {
    const result = await createFromExtraction([]);

    expect(result).toBeNull();
    expect(proposalRepository.save).not.toHaveBeenCalled();
    expect(proposalItemRepository.save).not.toHaveBeenCalled();
  });

  it('should create a proposal and its items when no proposal exists for the sourceKey', async () => {
    const result = await createFromExtraction([jobTitleItem]);

    expect(proposalRepository.findOne).toHaveBeenCalledWith({
      where: {
        workspaceId: 'workspace-1',
        sourceKey: 'ingestion:message:msg-1',
      },
    });
    expect(proposalRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        sourceKey: 'ingestion:message:msg-1',
        reason: 'Extracted from an email',
        threadId: null,
        createdByActor,
        status: ProposalStatus.PENDING,
      }),
    );
    expect(proposalItemRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: 'proposal-1',
        actionType: ProposalActionType.UPDATE_RECORD,
        objectNameSingular: 'person',
        recordId: 'record-1',
        payload: { jobTitle: 'VP Sales' },
        baseline: { jobTitle: 'Sales Manager' },
        factIds: ['fact-1'],
        status: ProposalItemStatus.PENDING,
      }),
    );
    expect(result).toEqual({ proposalId: 'proposal-1', itemIds: ['item-1'] });
  });

  it('should set an expiry in the future rather than leaving the proposal open forever', async () => {
    await createFromExtraction([jobTitleItem]);

    const { expiresAt } = proposalRepository.save.mock.calls[0][0];

    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('should be idempotent on retry: return null and write nothing when a proposal already exists for the sourceKey', async () => {
    proposalRepository.findOne.mockResolvedValue({
      id: 'proposal-existing',
      sourceKey: 'ingestion:message:msg-1',
    });

    const result = await createFromExtraction([jobTitleItem]);

    expect(result).toBeNull();
    expect(proposalRepository.save).not.toHaveBeenCalled();
    expect(proposalItemRepository.save).not.toHaveBeenCalled();
  });

  // A workspace FORBID on the touched object/field must suppress an
  // ingestion write exactly as it suppresses a tool-dispatch write.
  it('should return null and write nothing when the workspace policy FORBIDs every item', async () => {
    setPolicy({
      default: 'PROPOSE',
      overrides: { 'person.jobTitle': 'FORBID' },
    });

    const result = await createFromExtraction([jobTitleItem]);

    expect(result).toBeNull();
    expect(proposalRepository.save).not.toHaveBeenCalled();
    expect(proposalItemRepository.save).not.toHaveBeenCalled();
  });

  it('should return null when an object-level FORBID covers every item', async () => {
    setPolicy({ default: 'PROPOSE', overrides: { person: 'FORBID' } });

    const result = await createFromExtraction([jobTitleItem, phoneItem]);

    expect(result).toBeNull();
    expect(proposalRepository.save).not.toHaveBeenCalled();
  });

  it('should drop only the FORBIDden item and still create a proposal for the rest', async () => {
    setPolicy({
      default: 'PROPOSE',
      overrides: { 'person.jobTitle': 'FORBID' },
    });

    const result = await createFromExtraction(
      [jobTitleItem, phoneItem],
      'ingestion:message:msg-2',
    );

    expect(proposalItemRepository.save).toHaveBeenCalledTimes(1);
    expect(proposalItemRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: 'record-2' }),
    );
    expect(result).toEqual({ proposalId: 'proposal-1', itemIds: ['item-1'] });
  });

  // AUTO is a policy the human set for the ordinary write path; it must not
  // turn an ingestion candidate into a direct record write here.
  it('should still create a proposal when the policy is AUTO — this path never writes records', async () => {
    setPolicy({ default: 'AUTO', overrides: {} });

    const result = await createFromExtraction([jobTitleItem]);

    expect(result).toEqual({ proposalId: 'proposal-1', itemIds: ['item-1'] });
    expect(proposalItemRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: ProposalItemStatus.PENDING }),
    );
  });

  it('should attach no facts for an item with no record id', async () => {
    await createFromExtraction([
      {
        actionType: ProposalActionType.CREATE_RECORD,
        objectNameSingular: 'person',
        recordId: null,
        payload: { name: 'Ada' },
        baseline: {},
      },
    ]);

    expect(factService.findCurrentFactIdsForFields).not.toHaveBeenCalled();
    expect(proposalItemRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ factIds: [] }),
    );
  });
  // Important 7. The find-then-save dedupe is not atomic; two concurrent
  // retries of the same message-sync job both miss the read.
  // IDX_PROPOSAL_SOURCE_KEY_UNIQUE is what actually enforces one proposal per
  // source, and losing that race must read as "already proposed", not as a
  // 500 with a half-built proposal behind it.
  it('should return null instead of throwing when a concurrent retry already claimed the sourceKey', async () => {
    proposalRepository.save.mockRejectedValueOnce(
      Object.assign(
        new Error(
          'duplicate key value violates unique constraint "IDX_PROPOSAL_SOURCE_KEY_UNIQUE"',
        ),
        { code: '23505' },
      ),
    );

    const result = await createFromExtraction([jobTitleItem]);

    expect(result).toBeNull();
    expect(proposalItemRepository.save).not.toHaveBeenCalled();
  });

  it('should rethrow a save failure that is not a unique violation', async () => {
    proposalRepository.save.mockRejectedValueOnce(
      Object.assign(new Error('connection terminated'), { code: '08006' }),
    );

    await expect(createFromExtraction([jobTitleItem])).rejects.toThrow(
      'connection terminated',
    );
  });
  // A proposal nobody can see is a proposal nobody approves.
  it('should raise one in-app notification, deduped on the proposal id, when a proposal is created', async () => {
    await createFromExtraction([jobTitleItem]);

    expect(notificationService.raise).toHaveBeenCalledTimes(1);
    expect(notificationService.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        title: 'A proposal is waiting for review',
        linkPath: '/settings/ai/approvals',
        dedupeKey: 'proposal:proposal-1',
      }),
    );
  });

  it('should raise no notification when policy suppression means nothing is reviewable', async () => {
    setPolicy({ default: 'FORBID', overrides: {} });

    const result = await createFromExtraction([jobTitleItem]);

    expect(result).toBeNull();
    expect(notificationService.raise).not.toHaveBeenCalled();
  });

  // The proposal is already captured; losing the bell must not lose the draft.
  it('should still return the proposal when raising the notification throws', async () => {
    notificationService.raise.mockRejectedValueOnce(new Error('redis down'));

    const result = await createFromExtraction([jobTitleItem]);

    expect(result?.proposalId).toBe('proposal-1');
  });
});
