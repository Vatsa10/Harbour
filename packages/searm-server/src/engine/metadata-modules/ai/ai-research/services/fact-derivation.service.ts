import { Injectable } from '@nestjs/common';

import { isDefined } from 'searm-shared/utils';

import { type EvidenceEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/evidence.entity';
import { FactEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/fact.entity';
import { FactStatus } from 'src/engine/metadata-modules/ai/ai-research/types/fact-status.type';
import { InjectWorkspaceScopedRepository } from 'src/engine/searm-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { WorkspaceScopedRepository } from 'src/engine/searm-orm/workspace-scoped-repository/workspace-scoped-repository';
import { isPostgresUniqueViolation } from 'src/utils/is-postgres-unique-violation.util';

const isSameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

@Injectable()
export class FactDerivationService {
  constructor(
    // Scoped wrapper, not the raw repository: every read and write here is
    // keyed by workspaceId first, so the wrapper's forced tenant predicate
    // fits exactly and removes the chance of a cross-workspace fact.
    @InjectWorkspaceScopedRepository(FactEntity)
    private readonly factRepository: WorkspaceScopedRepository<FactEntity>,
  ) {}

  // Deterministic — no LLM in this path. The agent already reported what it
  // saw when it called record_evidence; everything from here on is plain
  // comparison logic a human can audit without re-reading a prompt.
  // The read-then-write below is not atomic, and it cannot be: the CURRENT
  // lookup, the corroboration branch and the supersession branch are three
  // different writes. The database settles the race instead —
  // IDX_FACT_CURRENT_UNIQUE rejects the second concurrent insert, and the
  // loser re-derives against the row the winner just committed, which lands
  // in the corroboration or supersession branch exactly as if it had arrived
  // second in the first place. One retry only: a second violation is a real
  // fault, not a race.
  async deriveFact(evidence: EvidenceEntity): Promise<FactEntity | null> {
    try {
      return await this.deriveFactOnce(evidence);
    } catch (error) {
      if (!isPostgresUniqueViolation(error)) {
        throw error;
      }

      return this.deriveFactOnce(evidence);
    }
  }

  private async deriveFactOnce(
    evidence: EvidenceEntity,
  ): Promise<FactEntity | null> {
    const { workspaceId, objectNameSingular, recordId } = evidence;
    const { fieldName, value } = evidence.payload;

    // The dismissal check runs FIRST, unconditionally. It used to sit inside
    // the "no CURRENT fact yet" branch, which meant a dismissed value
    // re-observed while any CURRENT fact existed superseded that fact and
    // re-proposed itself — the exact nag this rule exists to prevent.
    const wasDismissed = await this.wasValueDismissed({
      workspaceId,
      objectNameSingular,
      recordId,
      fieldName,
      value,
    });

    // Keep the evidence on file (it stays in the evidence table forever) but
    // do not derive a fact from it — this is the "don't nag" rule.
    if (wasDismissed) {
      return null;
    }

    const existingCurrent = await this.factRepository.findOne(workspaceId, {
      where: {
        objectNameSingular,
        recordId,
        fieldName,
        status: FactStatus.CURRENT,
      },
    });

    if (!isDefined(existingCurrent)) {
      return this.factRepository.save(
        workspaceId,
        this.buildNewFact(evidence, { hasConflict: false }),
      ) as Promise<FactEntity>;
    }

    if (isSameValue(existingCurrent.value, value)) {
      // Corroboration: same claim from another observation. Grow the
      // citation list rather than creating a second row for an unchanged
      // value. Freshness only moves forward — a newly-found source dated
      // last year must not make a fact look freshly confirmed.
      return this.factRepository.save(workspaceId, {
        ...existingCurrent,
        evidenceIds: [...existingCurrent.evidenceIds, evidence.id],
        runId: evidence.runId,
        lastObservedAt:
          evidence.observedAt > existingCurrent.lastObservedAt
            ? evidence.observedAt
            : existingCurrent.lastObservedAt,
      });
    }

    // Different value. Same run means the agent observed a contradiction
    // within one research pass, not a change over time — surface it as a
    // conflict on both facts rather than silently superseding.
    const isSameRunConflict = existingCurrent.runId === evidence.runId;

    if (isSameRunConflict) {
      await this.factRepository.save(workspaceId, {
        ...existingCurrent,
        hasConflict: true,
      });

      return this.factRepository.save(
        workspaceId,
        this.buildNewFact(evidence, { hasConflict: true }),
      ) as Promise<FactEntity>;
    }

    // Different run, different value: time passed and the world changed.
    // Supersede — keep the history, don't delete it. The old row stays
    // queryable with its own value and evidence, and points forward to the
    // fact that replaced it.
    //
    // The outgoing row leaves CURRENT *before* the replacement is inserted:
    // IDX_FACT_CURRENT_UNIQUE forbids two uncontested CURRENT rows for one
    // field, so the old order (insert, then supersede) would now always
    // violate it. The forward pointer is written once the successor has an id.
    const supersededAt = new Date();

    await this.factRepository.save(workspaceId, {
      ...existingCurrent,
      status: FactStatus.SUPERSEDED,
      supersededAt,
    });

    const newFact = (await this.factRepository.save(
      workspaceId,
      this.buildNewFact(evidence, { hasConflict: false }),
    )) as FactEntity;

    await this.factRepository.save(workspaceId, {
      ...existingCurrent,
      status: FactStatus.SUPERSEDED,
      supersededAt,
      supersededByFactId: newFact.id,
    });

    return newFact;
  }

  private buildNewFact(
    evidence: EvidenceEntity,
    options: { hasConflict: boolean },
  ): Partial<FactEntity> {
    return {
      workspaceId: evidence.workspaceId,
      objectNameSingular: evidence.objectNameSingular,
      recordId: evidence.recordId,
      fieldName: evidence.payload.fieldName,
      value: evidence.payload.value,
      status: FactStatus.CURRENT,
      hasConflict: options.hasConflict,
      strength: evidence.strength,
      evidenceIds: [evidence.id],
      runId: evidence.runId,
      lastObservedAt: evidence.observedAt,
    };
  }

  // find(), not findOne(): the query cannot filter on a jsonb `value` portably,
  // so every dismissed row for the field is loaded and compared. findOne()
  // returned one arbitrary row, which made the check nondeterministic as soon
  // as a reviewer dismissed two different values for the same field.
  private async wasValueDismissed(params: {
    workspaceId: string;
    objectNameSingular: string;
    recordId: string;
    fieldName: string;
    value: unknown;
  }): Promise<boolean> {
    const dismissed = await this.factRepository.find(params.workspaceId, {
      where: {
        objectNameSingular: params.objectNameSingular,
        recordId: params.recordId,
        fieldName: params.fieldName,
        status: FactStatus.DISMISSED,
      },
    });

    return dismissed.some((fact) => isSameValue(fact.value, params.value));
  }
}
