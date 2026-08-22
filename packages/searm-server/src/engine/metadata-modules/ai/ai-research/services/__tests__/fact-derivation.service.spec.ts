import { Test, type TestingModule } from '@nestjs/testing';
import { ModuleRef } from '@nestjs/core';

import { FactEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/fact.entity';
import { FactDerivationService } from 'src/engine/metadata-modules/ai/ai-research/services/fact-derivation.service';
import { FactStatus } from 'src/engine/metadata-modules/ai/ai-research/types/fact-status.type';
import { ProposalCreationService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-creation.service';
import { getWorkspaceScopedRepositoryToken } from 'src/engine/searm-orm/workspace-scoped-repository/get-workspace-scoped-repository-token.util';

const buildEvidence = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'evidence-1',
    workspaceId: 'workspace-1',
    objectNameSingular: 'company',
    recordId: 'record-1',
    runId: 'run-1',
    sourceType: 'CRM_RECORD',
    strength: 'STRONG',
    observedAt: new Date('2026-08-01T00:00:00.000Z'),
    payload: { fieldName: 'employeeCount', value: '500' },
    ...overrides,
  }) as never;

describe('FactDerivationService', () => {
  let service: FactDerivationService;

  // findOne answers the CURRENT lookup; find answers the dismissal lookup.
  // Two distinct methods rather than ordered mockResolvedValueOnce calls, so
  // reordering the two lookups in the service cannot silently pass.
  const factRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    delete: jest.fn(),
    softDelete: jest.fn(),
  };

  const proposalCreationService = {
    createFromExtraction: jest.fn(),
  };

  // Resolved via ModuleRef, same pattern as RecordEvidenceTool: AiResearchModule
  // cannot import AiWriteApprovalModule without a real circular edge, since
  // AiWriteApprovalModule already imports AiResearchModule for FactService.
  const moduleRef = {
    get: jest.fn().mockImplementation(() => proposalCreationService),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    factRepository.findOne.mockResolvedValue(null);
    factRepository.find.mockResolvedValue([]);
    // Scoped repository signature: (workspaceId, entity).
    factRepository.save.mockImplementation(async (_workspaceId, entity) => ({
      id: entity.id ?? 'fact-new',
      ...entity,
    }));
    proposalCreationService.createFromExtraction.mockResolvedValue({
      proposalId: 'proposal-1',
      itemIds: ['item-1'],
    });
    moduleRef.get.mockImplementation(() => proposalCreationService);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FactDerivationService,
        {
          provide: getWorkspaceScopedRepositoryToken(FactEntity),
          useValue: factRepository,
        },
        {
          provide: ModuleRef,
          useValue: moduleRef,
        },
      ],
    }).compile();

    service = module.get<FactDerivationService>(FactDerivationService);
  });

  it('should create a new CURRENT fact when none exists yet', async () => {
    const fact = await service.deriveFact(buildEvidence());

    expect(factRepository.save).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({
        fieldName: 'employeeCount',
        value: '500',
        status: FactStatus.CURRENT,
        hasConflict: false,
        evidenceIds: ['evidence-1'],
        strength: 'STRONG',
        lastObservedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    );
    expect(fact?.status).toBe(FactStatus.CURRENT);
  });

  it('should append to evidenceIds and advance freshness when the same value is corroborated', async () => {
    factRepository.findOne.mockResolvedValue({
      id: 'fact-1',
      value: '500',
      status: FactStatus.CURRENT,
      evidenceIds: ['evidence-0'],
      runId: 'run-0',
      lastObservedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await service.deriveFact(buildEvidence({ id: 'evidence-2' }));

    expect(factRepository.save).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({
        id: 'fact-1',
        evidenceIds: ['evidence-0', 'evidence-2'],
        lastObservedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    );
    // Corroboration grows the citation list on the existing row. A second
    // save would mean a duplicate CURRENT row for an unchanged value, which
    // makes the CURRENT lookup nondeterministic from then on.
    expect(factRepository.save).toHaveBeenCalledTimes(1);
  });

  it('should not move freshness backwards when an older observation corroborates', async () => {
    factRepository.findOne.mockResolvedValue({
      id: 'fact-1',
      value: '500',
      status: FactStatus.CURRENT,
      evidenceIds: ['evidence-0'],
      runId: 'run-0',
      lastObservedAt: new Date('2026-08-01T00:00:00.000Z'),
    });

    await service.deriveFact(
      buildEvidence({
        id: 'evidence-2',
        observedAt: new Date('2025-01-01T00:00:00.000Z'),
      }),
    );

    expect(factRepository.save).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({
        lastObservedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    );
  });

  // Charter fix: a cross-run disagreement used to auto-supersede the prior
  // fact with the new value, silently asserting a change nobody approved.
  // It must now route to a human via ProposalCreationService instead of
  // writing a new Fact row at all.
  it('should route a cross-run conflicting value to a proposal instead of superseding the fact', async () => {
    factRepository.findOne.mockResolvedValue({
      id: 'fact-1',
      value: '400',
      status: FactStatus.CURRENT,
      evidenceIds: ['evidence-0'],
      runId: 'run-0',
      lastObservedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const fact = await service.deriveFact(buildEvidence({ runId: 'run-1' }));

    // No new Fact row is written for the disputed value — the value is only
    // ever proposed, never asserted, until a human approves it.
    expect(factRepository.save).not.toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({ value: '500', status: FactStatus.CURRENT }),
    );
    expect(fact).toBeNull();

    expect(proposalCreationService.createFromExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        sourceKey: 'fact-derivation:evidence-1',
        items: [
          expect.objectContaining({
            objectNameSingular: 'company',
            recordId: 'record-1',
            payload: { employeeCount: '500' },
            baseline: { employeeCount: '400' },
          }),
        ],
      }),
    );

    expect(factRepository.remove).not.toHaveBeenCalled();
    expect(factRepository.delete).not.toHaveBeenCalled();
    expect(factRepository.softDelete).not.toHaveBeenCalled();
  });

  // Weak/model-asserted evidence must never mint a Fact on its own — it goes
  // to a human via a proposal, even when there is no existing fact to
  // conflict with.
  it('should route a WEAK observation to a proposal instead of creating a Fact when none exists yet', async () => {
    const fact = await service.deriveFact(
      buildEvidence({ strength: 'WEAK', sourceType: 'WEB_SEARCH' }),
    );

    expect(fact).toBeNull();
    expect(factRepository.save).not.toHaveBeenCalled();
    expect(proposalCreationService.createFromExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        sourceKey: 'fact-derivation:evidence-1',
        items: [
          expect.objectContaining({
            objectNameSingular: 'company',
            recordId: 'record-1',
            payload: { employeeCount: '500' },
            baseline: {},
          }),
        ],
      }),
    );
  });

  // Charter fix: a same-run contradiction used to write a second CURRENT-ish
  // Fact row flagged hasConflict on both sides. Now it must route to a human
  // as a proposal instead of ever asserting the new value as a Fact — the
  // existing fact is still flagged hasConflict for visibility, but no second
  // Fact row is written.
  it('should mark the existing fact conflicted and route the new value to a proposal when it arrives from the same run', async () => {
    factRepository.findOne.mockResolvedValue({
      id: 'fact-1',
      value: '400',
      status: FactStatus.CURRENT,
      evidenceIds: ['evidence-0'],
      runId: 'run-1',
      lastObservedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const fact = await service.deriveFact(buildEvidence({ runId: 'run-1' }));

    expect(fact).toBeNull();
    expect(factRepository.save).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({ id: 'fact-1', hasConflict: true }),
    );
    // No second Fact row for the disputed value — both claims stay visible
    // only through the fact history and the new proposal, never as a second
    // asserted Fact.
    expect(factRepository.save).not.toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({ value: '500', status: FactStatus.CURRENT }),
    );
    // A same-run contradiction is not a change over time, so the prior fact
    // must NOT be superseded — both claims stay visible to the reviewer.
    expect(factRepository.save).not.toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({ status: FactStatus.SUPERSEDED }),
    );
    expect(proposalCreationService.createFromExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        sourceKey: 'fact-derivation:evidence-1',
        items: [
          expect.objectContaining({
            objectNameSingular: 'company',
            recordId: 'record-1',
            payload: { employeeCount: '500' },
            baseline: { employeeCount: '400' },
          }),
        ],
      }),
    );
  });

  it('should not re-propose a value a human already dismissed', async () => {
    factRepository.find.mockResolvedValue([
      { id: 'fact-dismissed', value: '500', status: FactStatus.DISMISSED },
    ]);

    const fact = await service.deriveFact(buildEvidence());

    expect(fact).toBeNull();
    expect(factRepository.save).not.toHaveBeenCalled();
  });

  // I4(a): the dismissal check used to sit inside the "no CURRENT fact yet"
  // branch, so a dismissed value re-observed while any CURRENT fact existed
  // superseded it and re-proposed — the exact nag the feature prevents.
  it('should still suppress a dismissed value when a different CURRENT fact exists for the field', async () => {
    factRepository.findOne.mockResolvedValue({
      id: 'fact-1',
      value: '400',
      status: FactStatus.CURRENT,
      evidenceIds: ['evidence-0'],
      runId: 'run-0',
      lastObservedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    factRepository.find.mockResolvedValue([
      { id: 'fact-dismissed', value: '500', status: FactStatus.DISMISSED },
    ]);

    const fact = await service.deriveFact(buildEvidence({ runId: 'run-1' }));

    expect(fact).toBeNull();
    expect(factRepository.save).not.toHaveBeenCalled();
  });

  // I4(b): findOne with no value filter returned an arbitrary dismissed row,
  // so two dismissed values on one field made the check nondeterministic.
  it('should check every dismissed value for the field, not an arbitrary one', async () => {
    factRepository.find.mockResolvedValue([
      { id: 'fact-dismissed-a', value: '300', status: FactStatus.DISMISSED },
      { id: 'fact-dismissed-b', value: '500', status: FactStatus.DISMISSED },
    ]);

    const fact = await service.deriveFact(buildEvidence());

    expect(fact).toBeNull();
    expect(factRepository.save).not.toHaveBeenCalled();
  });

  // Pins that the dismissal lookup is scoped to this record and field and to
  // DISMISSED rows only. Without this, a service that loaded every fact in
  // the workspace would still pass every other test in this file while
  // suppressing unrelated values that merely happened to match.
  it('should scope the dismissal lookup to the record, field and DISMISSED status', async () => {
    await service.deriveFact(buildEvidence());

    expect(factRepository.find).toHaveBeenCalledWith('workspace-1', {
      where: {
        objectNameSingular: 'company',
        recordId: 'record-1',
        fieldName: 'employeeCount',
        status: FactStatus.DISMISSED,
      },
    });
  });

  it('should create the fact when a different value was dismissed', async () => {
    factRepository.find.mockResolvedValue([
      { id: 'fact-dismissed-a', value: '300', status: FactStatus.DISMISSED },
    ]);

    const fact = await service.deriveFact(buildEvidence());

    expect(fact?.status).toBe(FactStatus.CURRENT);
  });

  // Critical 3. Charter contract 2: "a retry must never duplicate a fact."
  // The lookup-then-insert is not atomic, so IDX_FACT_CURRENT_UNIQUE is what
  // actually enforces the invariant — these two tests pin the service's half
  // of that bargain.
  describe('concurrent derivation for the same (recordId, fieldName)', () => {
    it('should re-derive against the winner rather than duplicating when the CURRENT unique index rejects the insert', async () => {
      const uniqueViolation = Object.assign(
        new Error(
          'duplicate key value violates unique constraint "IDX_FACT_CURRENT_UNIQUE"',
        ),
        { code: '23505' },
      );

      // First pass: no CURRENT fact visible, so the service inserts — and
      // loses the race. Second pass: the winner's row is now visible.
      factRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'fact-winner',
          value: '500',
          status: FactStatus.CURRENT,
          evidenceIds: ['evidence-0'],
          runId: 'run-0',
          lastObservedAt: new Date('2026-01-01T00:00:00.000Z'),
        });

      factRepository.save.mockRejectedValueOnce(uniqueViolation);

      const fact = await service.deriveFact(buildEvidence());

      // Same value as the winner: the losing observation corroborates it,
      // growing the citation list instead of creating a second CURRENT row.
      expect(fact).toEqual(
        expect.objectContaining({
          id: 'fact-winner',
          evidenceIds: ['evidence-0', 'evidence-1'],
        }),
      );
      expect(factRepository.save).toHaveBeenCalledTimes(2);
      expect(factRepository.save).not.toHaveBeenCalledWith(
        'workspace-1',
        expect.objectContaining({ id: undefined, status: FactStatus.CURRENT }),
      );
    });

    it('should rethrow a non-unique-violation failure instead of retrying it', async () => {
      const boom = Object.assign(new Error('connection terminated'), {
        code: '08006',
      });

      factRepository.save.mockRejectedValueOnce(boom);

      await expect(service.deriveFact(buildEvidence())).rejects.toThrow(
        'connection terminated',
      );
      expect(factRepository.save).toHaveBeenCalledTimes(1);
    });
  });

  // Supersession-on-conflict is gone: a cross-run disagreement never writes a
  // new Fact row at all now, so there is nothing to order against a
  // predecessor demotion. This test used to pin that ordering; it now pins
  // that no Fact write happens for either row in the conflicting pair.
  it('should not write any Fact row for either the existing or new value on a cross-run conflict', async () => {
    factRepository.findOne.mockResolvedValue({
      id: 'fact-1',
      value: '400',
      status: FactStatus.CURRENT,
      hasConflict: false,
      evidenceIds: ['evidence-0'],
      runId: 'run-0',
      lastObservedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await service.deriveFact(buildEvidence({ runId: 'run-2' }));

    expect(factRepository.save).not.toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({ status: FactStatus.SUPERSEDED }),
    );
    expect(factRepository.save).not.toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({ value: '500', status: FactStatus.CURRENT }),
    );
  });
});
