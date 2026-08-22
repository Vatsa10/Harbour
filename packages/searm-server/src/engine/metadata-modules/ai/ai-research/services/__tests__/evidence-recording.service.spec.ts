import { Test, type TestingModule } from '@nestjs/testing';

import { EvidenceEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/evidence.entity';
import { FactEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/fact.entity';
import { EvidenceRecordingService } from 'src/engine/metadata-modules/ai/ai-research/services/evidence-recording.service';
import { FactDerivationService } from 'src/engine/metadata-modules/ai/ai-research/services/fact-derivation.service';
import { FactStatus } from 'src/engine/metadata-modules/ai/ai-research/types/fact-status.type';
import { hashEvidencePayload } from 'src/engine/metadata-modules/ai/ai-research/utils/hash-evidence-payload.util';
import { getWorkspaceScopedRepositoryToken } from 'src/engine/searm-orm/workspace-scoped-repository/get-workspace-scoped-repository-token.util';

describe('EvidenceRecordingService', () => {
  let service: EvidenceRecordingService;

  const evidenceRepository = { save: jest.fn() };
  const factRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Scoped repository signature: (workspaceId, entity). The real wrapper
    // stamps workspaceId onto the saved row, so the double does too.
    evidenceRepository.save.mockImplementation(async (workspaceId, entity) => ({
      id: 'evidence-1',
      workspaceId,
      ...entity,
    }));
    factRepository.findOne.mockResolvedValue(null);
    factRepository.find.mockResolvedValue([]);
    factRepository.save.mockImplementation(async (_workspaceId, entity) => ({
      id: 'fact-1',
      ...entity,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvidenceRecordingService,
        // The real derivation service. See the note above the end-to-end test.
        FactDerivationService,
        {
          provide: getWorkspaceScopedRepositoryToken(EvidenceEntity),
          useValue: evidenceRepository,
        },
        {
          provide: getWorkspaceScopedRepositoryToken(FactEntity),
          useValue: factRepository,
        },
      ],
    }).compile();

    service = module.get<EvidenceRecordingService>(EvidenceRecordingService);
  });

  it('should assign STRONG strength for a server-observed CRM_RECORD source deterministically', async () => {
    await service.recordEvidence({
      workspaceId: 'workspace-1',
      runId: 'run-1',
      objectNameSingular: 'company',
      recordId: 'record-1',
      sourceType: 'CRM_RECORD',
      assertedBy: 'SERVER',
      sourceLocator: 'internal:company:record-1',
      extractor: 'agent-run:agent-1',
      payload: { fieldName: 'employeeCount', value: '500' },
    });

    expect(evidenceRepository.save).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({ strength: 'STRONG' }),
    );
  });

  it('should assign WEAK strength for a WEB_SEARCH source', async () => {
    await service.recordEvidence({
      workspaceId: 'workspace-1',
      runId: 'run-1',
      objectNameSingular: 'company',
      recordId: 'record-1',
      sourceType: 'WEB_SEARCH',
      assertedBy: 'SERVER',
      sourceLocator: 'https://example.com',
      extractor: 'agent-run:agent-1',
      payload: { fieldName: 'employeeCount', value: '500' },
    });

    expect(evidenceRepository.save).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({ strength: 'WEAK' }),
    );
  });

  // Critical 5. sourceType is a free enum on the record_evidence tool schema,
  // so this is the route a model uses to promote its own guess. The strength
  // table alone said CRM_RECORD -> STRONG; a model wanting a STRONG citation
  // typed eight characters and the approval UI rendered it as corroboration.
  it('should mark a model-asserted observation WEAK even when it claims the strongest source type', async () => {
    for (const sourceType of ['CRM_RECORD', 'CRM_ACTIVITY', 'MANUAL', 'IMPORT_FILE'] as const) {
      await service.recordEvidence({
        workspaceId: 'workspace-1',
        runId: 'run-1',
        objectNameSingular: 'company',
        recordId: 'record-1',
        sourceType,
        assertedBy: 'MODEL',
        sourceLocator: 'https://example.com/fabricated',
        extractor: 'record_evidence',
        payload: { fieldName: 'employeeCount', value: '500' },
      });
    }

    for (const [, entity] of evidenceRepository.save.mock.calls) {
      expect(entity.strength).toBe('WEAK');
    }
    expect(evidenceRepository.save).toHaveBeenCalledTimes(4);
  });

  it('should still let a server-observed IMPORT_FILE source be STRONG', async () => {
    await service.recordEvidence({
      workspaceId: 'workspace-1',
      runId: null,
      objectNameSingular: 'company',
      recordId: 'record-1',
      sourceType: 'IMPORT_FILE',
      assertedBy: 'SERVER',
      sourceLocator: 'importBatch:batch-1:row:7',
      extractor: 'guided-import',
      payload: { fieldName: 'employeeCount', value: '500' },
    });

    expect(evidenceRepository.save).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({ strength: 'STRONG' }),
    );
  });

  // Real seam: no deriveFact mock stands between recording and the fact row.
  // A WEB_SEARCH observation must land as a WEAK CURRENT fact carrying the
  // observation date as its freshness, end to end.
  it('should compute a payload hash and derive a real CURRENT fact through the live derivation service', async () => {
    const payload = { fieldName: 'employeeCount', value: '500' };

    await service.recordEvidence({
      workspaceId: 'workspace-1',
      runId: 'run-1',
      objectNameSingular: 'company',
      recordId: 'record-1',
      sourceType: 'WEB_SEARCH',
      assertedBy: 'SERVER',
      sourceLocator: 'https://example.com/about',
      extractor: 'agent-run:agent-1',
      observedAt: new Date('2026-08-01T00:00:00.000Z'),
      payload,
    });

    expect(evidenceRepository.save).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({
        payloadHash: hashEvidencePayload(payload),
        sourceLocator: 'https://example.com/about',
        extractor: 'agent-run:agent-1',
        observedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    );
    expect(evidenceRepository.save).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({
        payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    expect(factRepository.save).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({
        objectNameSingular: 'company',
        recordId: 'record-1',
        fieldName: 'employeeCount',
        value: '500',
        status: FactStatus.CURRENT,
        strength: 'WEAK',
        evidenceIds: ['evidence-1'],
        lastObservedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    );
  });

  // Real seam, negative case: the dismissal rule has to hold through the
  // recording entry point, not only when deriveFact is called directly.
  it('should record the evidence but derive no fact when the value was already dismissed', async () => {
    factRepository.find.mockResolvedValue([
      { id: 'fact-dismissed', value: '500', status: FactStatus.DISMISSED },
    ]);

    await service.recordEvidence({
      workspaceId: 'workspace-1',
      runId: 'run-1',
      objectNameSingular: 'company',
      recordId: 'record-1',
      sourceType: 'WEB_SEARCH',
      assertedBy: 'SERVER',
      sourceLocator: 'https://example.com/about',
      extractor: 'agent-run:agent-1',
      payload: { fieldName: 'employeeCount', value: '500' },
    });

    expect(evidenceRepository.save).toHaveBeenCalled();
    expect(factRepository.save).not.toHaveBeenCalled();
  });

  // The evidence row is the audit trail; a derivation failure must not erase
  // the observation that was already persisted, but it must not be swallowed
  // either — the caller has to learn the fact pipeline broke.
  it('should surface a derivation failure rather than reporting a clean record', async () => {
    factRepository.findOne.mockRejectedValue(new Error('db down'));

    await expect(
      service.recordEvidence({
        workspaceId: 'workspace-1',
        runId: 'run-1',
        objectNameSingular: 'company',
        recordId: 'record-1',
        sourceType: 'WEB_SEARCH',
      assertedBy: 'SERVER',
        sourceLocator: 'https://example.com/about',
        extractor: 'agent-run:agent-1',
        payload: { fieldName: 'employeeCount', value: '500' },
      }),
    ).rejects.toThrow('db down');

    expect(evidenceRepository.save).toHaveBeenCalled();
  });
});
