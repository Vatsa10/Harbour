import { Test, type TestingModule } from '@nestjs/testing';

import { FactEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/fact.entity';
import { FactDerivationService } from 'src/engine/metadata-modules/ai/ai-research/services/fact-derivation.service';
import { FactStatus } from 'src/engine/metadata-modules/ai/ai-research/types/fact-status.type';
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

  beforeEach(async () => {
    jest.clearAllMocks();
    factRepository.findOne.mockResolvedValue(null);
    factRepository.find.mockResolvedValue([]);
    // Scoped repository signature: (workspaceId, entity).
    factRepository.save.mockImplementation(async (_workspaceId, entity) => ({
      id: entity.id ?? 'fact-new',
      ...entity,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FactDerivationService,
        {
          provide: getWorkspaceScopedRepositoryToken(FactEntity),
          useValue: factRepository,
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

  it('should supersede the prior fact when a different value arrives from a later run', async () => {
    factRepository.findOne.mockResolvedValue({
      id: 'fact-1',
      value: '400',
      status: FactStatus.CURRENT,
      evidenceIds: ['evidence-0'],
      runId: 'run-0',
      lastObservedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await service.deriveFact(buildEvidence({ runId: 'run-1' }));

    expect(factRepository.save).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({
        value: '500',
        status: FactStatus.CURRENT,
        hasConflict: false,
      }),
    );

    // The LAST write to the old row: the demotion out of CURRENT happens
    // before the successor exists (the partial unique index forbids two
    // uncontested CURRENT rows), so the forward pointer is written after.
    const supersededSave = factRepository.save.mock.calls
      .map(([, entity]) => entity)
      .filter((entity) => entity.id === 'fact-1')
      .pop();

    // Supersession is a status transition with a forward pointer, not a
    // delete: the old row keeps its value and evidence so "why did we once
    // believe 400" stays answerable, and it links to what replaced it.
    expect(supersededSave).toEqual(
      expect.objectContaining({
        id: 'fact-1',
        status: FactStatus.SUPERSEDED,
        value: '400',
        evidenceIds: ['evidence-0'],
        supersededByFactId: 'fact-new',
        supersededAt: expect.any(Date),
      }),
    );
    expect(factRepository.remove).not.toHaveBeenCalled();
    expect(factRepository.delete).not.toHaveBeenCalled();
    expect(factRepository.softDelete).not.toHaveBeenCalled();
  });

  it('should mark both facts conflicted when a different value arrives from the same run', async () => {
    factRepository.findOne.mockResolvedValue({
      id: 'fact-1',
      value: '400',
      status: FactStatus.CURRENT,
      evidenceIds: ['evidence-0'],
      runId: 'run-1',
      lastObservedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await service.deriveFact(buildEvidence({ runId: 'run-1' }));

    expect(factRepository.save).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({ id: 'fact-1', hasConflict: true }),
    );
    expect(factRepository.save).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({
        value: '500',
        status: FactStatus.CURRENT,
        hasConflict: true,
      }),
    );
    // A same-run contradiction is not a change over time, so the prior fact
    // must NOT be superseded — both claims stay visible to the reviewer.
    expect(factRepository.save).not.toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({ status: FactStatus.SUPERSEDED }),
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

  // Critical 3, second half: with a partial unique index over uncontested
  // CURRENT rows, inserting the successor while the predecessor is still
  // CURRENT would violate it on every ordinary supersession.
  it('should move the outgoing fact out of CURRENT before inserting its replacement', async () => {
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

    const savedStatuses = factRepository.save.mock.calls.map(
      ([, entity]) => `${entity.id ?? 'new'}:${entity.status}`,
    );

    // The predecessor's demotion must come first; the successor's insert must
    // not sit between two CURRENT rows for the same field.
    expect(savedStatuses).toEqual([
      `fact-1:${FactStatus.SUPERSEDED}`,
      `new:${FactStatus.CURRENT}`,
      `fact-1:${FactStatus.SUPERSEDED}`,
    ]);
  });
});
