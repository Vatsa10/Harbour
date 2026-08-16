import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { FactService } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import { ProposalSupersessionService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-supersession.service';
import {
  ProposalActionType,
  ProposalItemStatus,
  ProposalStatus,
} from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';

const WORKSPACE_ID = 'ws-1';

const buildItem = (overrides: Partial<ProposalItemEntity>): ProposalItemEntity =>
  ({
    id: 'item-x',
    proposalId: 'proposal-x',
    actionType: ProposalActionType.UPDATE_RECORD,
    objectNameSingular: 'person',
    recordId: 'record-1',
    toolId: null,
    toolCategory: null,
    payload: { jobTitle: 'VP Sales' },
    baseline: { jobTitle: 'Sales Manager' },
    status: ProposalItemStatus.PENDING,
    error: null,
    resultRecordId: null,
    factIds: [],
    supersededAt: null,
    supersededByProposalItemId: null,
    supersessionReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as ProposalItemEntity;

describe('ProposalSupersessionService', () => {
  let service: ProposalSupersessionService;

  const factService = { findNonCurrentFactIds: jest.fn() };
  const findRecordsService = { execute: jest.fn() };

  // The two update paths go through query builders, so the builders are
  // captured rather than stubbed away: the assertions below read the values
  // actually passed to .set(), which is where the behaviour lives.
  const itemUpdates: Record<string, unknown>[] = [];
  const proposalUpdates: Record<string, unknown>[] = [];

  const buildUpdateBuilder = (
    sink: Record<string, unknown>[],
    affected: number,
  ) => {
    const builder = {
      update: jest.fn(() => builder),
      set: jest.fn((values: Record<string, unknown>) => {
        sink.push(values);

        return builder;
      }),
      where: jest.fn(() => builder),
      andWhere: jest.fn(() => builder),
      execute: jest.fn(async () => ({ affected })),
    };

    return builder;
  };

  const proposalRepository = {
    find: jest.fn(),
    createQueryBuilder: jest.fn(() => buildUpdateBuilder(proposalUpdates, 1)),
  };
  const proposalItemRepository = {
    find: jest.fn(),
    createQueryBuilder: jest.fn(() => buildUpdateBuilder(itemUpdates, 1)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    itemUpdates.length = 0;
    proposalUpdates.length = 0;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProposalSupersessionService,
        { provide: FactService, useValue: factService },
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

    service = module.get(ProposalSupersessionService);
  });

  describe('supersedeOverlappingItems', () => {
    it('should supersede an older pending item that targets the same record and field', async () => {
      const newItem = buildItem({
        id: 'item-new',
        proposalId: 'proposal-new',
        payload: { jobTitle: 'Chief Revenue Officer' },
      });
      const olderItem = buildItem({
        id: 'item-old',
        proposalId: 'proposal-old',
        payload: { jobTitle: 'VP Sales' },
      });

      proposalItemRepository.find
        .mockResolvedValueOnce([newItem])
        .mockResolvedValueOnce([olderItem]);
      proposalRepository.find
        .mockResolvedValueOnce([{ id: 'proposal-old' }])
        .mockResolvedValueOnce([
          {
            id: 'proposal-old',
            items: [{ ...olderItem, status: ProposalItemStatus.SUPERSEDED }],
          },
        ]);

      const result = await service.supersedeOverlappingItems({
        workspaceId: WORKSPACE_ID,
        proposalId: 'proposal-new',
      });

      expect(result.supersededItemIds).toEqual(['item-old']);
      expect(itemUpdates).toHaveLength(1);
      expect(itemUpdates[0]).toMatchObject({
        status: ProposalItemStatus.SUPERSEDED,
        supersessionReason: 'NEWER_PROPOSAL',
        supersededByProposalItemId: 'item-new',
      });

      // The whole older proposal had nothing else answerable left, so the
      // envelope retires too and leaves the inbox.
      expect(result.supersededProposalIds).toEqual(['proposal-old']);
      expect(proposalUpdates[0]).toMatchObject({
        status: ProposalStatus.SUPERSEDED,
      });
    });

    it('should leave an older item alone when it touches a different field of the same record', async () => {
      const newItem = buildItem({
        id: 'item-new',
        proposalId: 'proposal-new',
        payload: { jobTitle: 'CRO' },
      });
      const olderItem = buildItem({
        id: 'item-old',
        proposalId: 'proposal-old',
        payload: { city: 'Berlin' },
      });

      proposalItemRepository.find
        .mockResolvedValueOnce([newItem])
        .mockResolvedValueOnce([olderItem]);
      proposalRepository.find
        .mockResolvedValueOnce([{ id: 'proposal-old' }])
        .mockResolvedValueOnce([
          { id: 'proposal-old', items: [olderItem] },
        ]);

      const result = await service.supersedeOverlappingItems({
        workspaceId: WORKSPACE_ID,
        proposalId: 'proposal-new',
      });

      expect(result.supersededItemIds).toEqual([]);
      expect(itemUpdates).toHaveLength(0);
      // A still-answerable item means the envelope stays in the inbox.
      expect(result.supersededProposalIds).toEqual([]);
    });

    it('should not supersede items inside the same proposal batch', async () => {
      const newItem = buildItem({ id: 'item-a', proposalId: 'proposal-new' });
      const sibling = buildItem({ id: 'item-b', proposalId: 'proposal-new' });

      proposalItemRepository.find.mockResolvedValueOnce([newItem, sibling]);
      // No OTHER pending proposals exist, so the item query is never reached.
      proposalRepository.find.mockResolvedValueOnce([]);

      const result = await service.supersedeOverlappingItems({
        workspaceId: WORKSPACE_ID,
        proposalId: 'proposal-new',
      });

      expect(result.supersededItemIds).toEqual([]);
      expect(itemUpdates).toHaveLength(0);
    });
  });

  describe('sweepWorkspace', () => {
    const setPendingProposal = (items: ProposalItemEntity[]) => {
      proposalRepository.find
        .mockResolvedValueOnce([
          { id: 'proposal-1', workspaceId: WORKSPACE_ID, items },
        ])
        // Roll-up re-read.
        .mockResolvedValueOnce([{ id: 'proposal-1', items }]);
    };

    it('should supersede an item whose every cited fact has left CURRENT', async () => {
      const item = buildItem({ id: 'item-1', factIds: ['fact-1', 'fact-2'] });

      setPendingProposal([item]);
      factService.findNonCurrentFactIds.mockResolvedValue([
        'fact-1',
        'fact-2',
      ]);

      const result = await service.sweepWorkspace(WORKSPACE_ID);

      expect(result.supersededItemIds).toEqual(['item-1']);
      expect(itemUpdates[0]).toMatchObject({
        supersessionReason: 'FACT_SUPERSEDED',
        supersededByProposalItemId: null,
      });
      // Evidence loss is decided without ever reading the CRM record.
      expect(findRecordsService.execute).not.toHaveBeenCalled();
    });

    it('should keep an item whose citations are only partly superseded and whose record is unchanged', async () => {
      const item = buildItem({ id: 'item-1', factIds: ['fact-1', 'fact-2'] });

      setPendingProposal([item]);
      factService.findNonCurrentFactIds.mockResolvedValue(['fact-1']);
      findRecordsService.execute.mockResolvedValue({
        success: true,
        result: { records: [{ jobTitle: 'Sales Manager' }] },
      });

      const result = await service.sweepWorkspace(WORKSPACE_ID);

      expect(result.supersededItemIds).toEqual([]);
      expect(itemUpdates).toHaveLength(0);
    });

    it('should supersede an item whose record was edited since the baseline was captured', async () => {
      const item = buildItem({ id: 'item-1' });

      setPendingProposal([item]);
      findRecordsService.execute.mockResolvedValue({
        success: true,
        result: { records: [{ jobTitle: 'Head of Sales' }] },
      });

      const result = await service.sweepWorkspace(WORKSPACE_ID);

      expect(result.supersededItemIds).toEqual(['item-1']);
      expect(itemUpdates[0]).toMatchObject({
        supersessionReason: 'RECORD_CHANGED',
      });
    });

    it('should supersede an item whose record was deleted', async () => {
      const item = buildItem({ id: 'item-1' });

      setPendingProposal([item]);
      findRecordsService.execute.mockResolvedValue({
        success: true,
        result: { records: [] },
      });

      const result = await service.sweepWorkspace(WORKSPACE_ID);

      expect(result.supersededItemIds).toEqual(['item-1']);
      expect(itemUpdates[0]).toMatchObject({
        supersessionReason: 'RECORD_CHANGED',
      });
    });

    // record-crud never throws; it returns success: false. A transient read
    // failure must not retire a good proposal.
    it('should leave the item pending when the baseline re-read fails', async () => {
      const item = buildItem({ id: 'item-1' });

      setPendingProposal([item]);
      findRecordsService.execute.mockResolvedValue({
        success: false,
        message: 'boom',
      });

      const result = await service.sweepWorkspace(WORKSPACE_ID);

      expect(result.supersededItemIds).toEqual([]);
      expect(itemUpdates).toHaveLength(0);
    });

    it('should skip items that are no longer pending', async () => {
      const applied = buildItem({
        id: 'item-1',
        status: ProposalItemStatus.APPLIED,
      });

      setPendingProposal([applied]);

      const result = await service.sweepWorkspace(WORKSPACE_ID);

      expect(result.supersededItemIds).toEqual([]);
      expect(findRecordsService.execute).not.toHaveBeenCalled();
      expect(factService.findNonCurrentFactIds).not.toHaveBeenCalled();
    });

    it('should do nothing when the workspace has no pending proposals', async () => {
      proposalRepository.find.mockResolvedValueOnce([]);

      const result = await service.sweepWorkspace(WORKSPACE_ID);

      expect(result).toEqual({
        supersededItemIds: [],
        supersededProposalIds: [],
      });
      expect(proposalItemRepository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
