import { Test, type TestingModule } from '@nestjs/testing';

import { RecordBriefEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/record-brief.entity';
import { FactService } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
import { RecordBriefService } from 'src/engine/metadata-modules/ai/ai-research/services/record-brief.service';
import { getWorkspaceScopedRepositoryToken } from 'src/engine/twenty-orm/workspace-scoped-repository/get-workspace-scoped-repository-token.util';

describe('RecordBriefService', () => {
  let service: RecordBriefService;

  const recordBriefRepository = {
    findOne: jest.fn(),
    delete: jest.fn(),
    upsertAndReturnOne: jest.fn(),
  };
  const factService = { findCurrentFactsForRecord: jest.fn() };

  const target = {
    workspaceId: 'workspace-1',
    objectNameSingular: 'person',
    recordId: 'record-1',
  };

  const strongFact = (fieldName: string, value: unknown, id: string) => ({
    id,
    fieldName,
    value,
    strength: 'STRONG',
    hasConflict: false,
    lastObservedAt: new Date('2026-02-02T00:00:00.000Z'),
    evidenceCount: 1,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    recordBriefRepository.delete.mockResolvedValue({ affected: 0 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordBriefService,
        {
          provide: getWorkspaceScopedRepositoryToken(RecordBriefEntity),
          useValue: recordBriefRepository,
        },
        { provide: FactService, useValue: factService },
      ],
    }).compile();

    service = module.get<RecordBriefService>(RecordBriefService);
  });

  it('should persist a brief composed from the record facts', async () => {
    factService.findCurrentFactsForRecord.mockResolvedValue([
      strongFact('name', 'Dana Okafor', 'f-name'),
      strongFact('jobTitle', 'Head of Revenue Operations', 'f-title'),
    ]);
    recordBriefRepository.upsertAndReturnOne.mockImplementation(
      async (_workspaceId, entity) => entity,
    );

    const result = await service.generateBrief(target);

    expect(result.written).toBe(true);
    expect(recordBriefRepository.upsertAndReturnOne).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({
        objectNameSingular: 'person',
        recordId: 'record-1',
        narrative: 'Dana Okafor is Head of Revenue Operations.',
        sections: { currentRole: 'Head of Revenue Operations' },
        factIds: ['f-title'],
      }),
      // The conflict target must be the record identity, or a regenerated
      // brief inserts a second row instead of replacing the first.
      ['workspaceId', 'objectNameSingular', 'recordId'],
    );
  });

  it('should write nothing and report why when no fact is well enough sourced', async () => {
    factService.findCurrentFactsForRecord.mockResolvedValue([
      { ...strongFact('jobTitle', 'CFO', 'f-title'), strength: 'WEAK' },
    ]);

    const result = await service.generateBrief(target);

    expect(result).toEqual({
      written: false,
      reason: 'NO_QUALIFYING_EVIDENCE',
    });
    expect(recordBriefRepository.upsertAndReturnOne).not.toHaveBeenCalled();
  });

  it('should distinguish a below-the-floor refusal from an unsourced one', async () => {
    factService.findCurrentFactsForRecord.mockResolvedValue([
      strongFact('city', 'Rome', 'f-city'),
    ]);

    const result = await service.generateBrief(target);

    expect(result).toEqual({
      written: false,
      reason: 'NARRATIVE_BELOW_FLOOR',
    });
  });

  it('should delete a previous brief when regeneration now refuses to write', async () => {
    factService.findCurrentFactsForRecord.mockResolvedValue([]);

    await service.generateBrief(target);

    // A brief left standing after its evidence was dismissed is exactly the
    // stale filler the feature refuses to show.
    expect(recordBriefRepository.delete).toHaveBeenCalledWith('workspace-1', {
      objectNameSingular: 'person',
      recordId: 'record-1',
    });
  });

  it('should scope the lookup to the workspace and the record', async () => {
    recordBriefRepository.findOne.mockResolvedValue(null);

    await expect(service.findBrief(target)).resolves.toBeNull();
    expect(recordBriefRepository.findOne).toHaveBeenCalledWith('workspace-1', {
      where: { objectNameSingular: 'person', recordId: 'record-1' },
    });
  });
});
