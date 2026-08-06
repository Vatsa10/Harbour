import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EvidenceEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/evidence.entity';
import { FactEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/fact.entity';
import { FactService } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
import { FactStatus } from 'src/engine/metadata-modules/ai/ai-research/types/fact-status.type';

describe('FactService', () => {
  let service: FactService;

  const factRepository = { find: jest.fn(), update: jest.fn() };
  const evidenceRepository = { find: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FactService,
        { provide: getRepositoryToken(FactEntity), useValue: factRepository },
        {
          provide: getRepositoryToken(EvidenceEntity),
          useValue: evidenceRepository,
        },
      ],
    }).compile();

    service = module.get<FactService>(FactService);
  });

  it('should return an empty array without querying when no field names are given', async () => {
    const ids = await service.findCurrentFactIdsForFields({
      workspaceId: 'workspace-1',
      objectNameSingular: 'person',
      recordId: 'record-1',
      fieldNames: [],
    });

    expect(ids).toEqual([]);
    expect(factRepository.find).not.toHaveBeenCalled();
  });

  it('should return the ids of CURRENT facts matching the given fields', async () => {
    factRepository.find.mockResolvedValue([{ id: 'fact-1' }, { id: 'fact-2' }]);

    const ids = await service.findCurrentFactIdsForFields({
      workspaceId: 'workspace-1',
      objectNameSingular: 'person',
      recordId: 'record-1',
      fieldNames: ['jobTitle', 'city'],
    });

    expect(factRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: 'workspace-1',
          objectNameSingular: 'person',
          recordId: 'record-1',
          status: FactStatus.CURRENT,
        }),
      }),
    );
    expect(ids).toEqual(['fact-1', 'fact-2']);
  });

  describe('findProposalItemFacts', () => {
    it('should return an empty array without querying for no ids', async () => {
      const facts = await service.findProposalItemFacts([]);

      expect(facts).toEqual([]);
      expect(factRepository.find).not.toHaveBeenCalled();
      expect(evidenceRepository.find).not.toHaveBeenCalled();
    });

    it('should flatten each fact with its first evidence row into one citation', async () => {
      factRepository.find.mockResolvedValue([
        {
          id: 'fact-1',
          fieldName: 'jobTitle',
          strength: 'WEAK',
          hasConflict: false,
          evidenceIds: ['evidence-1', 'evidence-2'],
        },
      ]);
      evidenceRepository.find.mockResolvedValue([
        {
          id: 'evidence-1',
          sourceType: 'WEB_SEARCH',
          sourceLocator: 'https://example.com/about',
          observedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ]);

      const facts = await service.findProposalItemFacts(['fact-1']);

      // Only the primary evidence id is fetched — not evidence-2.
      expect(evidenceRepository.find).toHaveBeenCalledWith({
        where: { id: expect.objectContaining({ _value: ['evidence-1'] }) },
      });
      expect(facts).toEqual([
        {
          id: 'fact-1',
          fieldName: 'jobTitle',
          strength: 'WEAK',
          hasConflict: false,
          sourceType: 'WEB_SEARCH',
          sourceLocator: 'https://example.com/about',
          observedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ]);
    });

    it('should return null source fields for a fact whose evidence row is missing', async () => {
      factRepository.find.mockResolvedValue([
        {
          id: 'fact-1',
          fieldName: 'jobTitle',
          strength: 'STRONG',
          hasConflict: true,
          evidenceIds: [],
        },
      ]);

      const facts = await service.findProposalItemFacts(['fact-1']);

      expect(evidenceRepository.find).not.toHaveBeenCalled();
      expect(facts[0]).toMatchObject({
        sourceType: null,
        sourceLocator: null,
        observedAt: null,
        hasConflict: true,
      });
    });
  });

  describe('markDismissed', () => {
    it('should not issue an update for an empty id list', async () => {
      await service.markDismissed([]);

      expect(factRepository.update).not.toHaveBeenCalled();
    });

    it('should set every named fact to DISMISSED', async () => {
      await service.markDismissed(['fact-1', 'fact-2']);

      expect(factRepository.update).toHaveBeenCalledWith(
        { id: expect.objectContaining({ _value: ['fact-1', 'fact-2'] }) },
        { status: FactStatus.DISMISSED },
      );
    });
  });
});
