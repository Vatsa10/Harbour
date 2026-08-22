import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { FieldActorSource } from 'searm-shared/types';
import { isDefined } from 'searm-shared/utils';

import { type EvidenceEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/evidence.entity';
import { FactEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/fact.entity';
import { FactStatus } from 'src/engine/metadata-modules/ai/ai-research/types/fact-status.type';
import { ProposalCreationService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-creation.service';
import { ProposalActionType } from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';
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
    // Resolved lazily via ModuleRef, same pattern as RecordEvidenceTool:
    // AiWriteApprovalModule already imports AiResearchModule (for FactService),
    // so a constructor-injected ProposalCreationService here would close a
    // real module cycle. `strict: false` resolves from the whole application
    // container, which is safe for this default-scoped provider.
    private readonly moduleRef: ModuleRef,
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
      // Charter rule: only STRONG (server-observed) evidence may mint a Fact
      // directly. WEAK evidence — anything a model asserted, or fetched from
      // outside the CRM — must go to a human as a proposal instead, even when
      // there is nothing yet to conflict with.
      if (evidence.strength === 'WEAK') {
        await this.proposeFieldChange(evidence, {
          oldValue: undefined,
          reason: `Weak/model-asserted observation for ${objectNameSingular}.${fieldName}`,
        });

        return null;
      }

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

    // Different value than the existing CURRENT fact — a conflict, whether it
    // arrived in the same run (the agent saw a contradiction within one
    // research pass) or a later one (the value may have changed over time, or
    // the new observation may simply be wrong). Either way this is exactly
    // the "conflicting observation" case the charter says must never
    // auto-resolve: it goes to a human as a proposal, never straight to a new
    // Fact row. Same-run vs cross-run no longer changes the write path — it
    // only changes the reason text a reviewer sees.
    //
    // The existing fact is still marked hasConflict: true for visibility in
    // fact history/UI. That is metadata on the row that is already the
    // asserted truth, not a new asserted value, so it does not touch the
    // evidence contract the way writing a second Fact would.
    await this.factRepository.save(workspaceId, {
      ...existingCurrent,
      hasConflict: true,
    });

    const isSameRunConflict = existingCurrent.runId === evidence.runId;

    await this.proposeFieldChange(evidence, {
      oldValue: existingCurrent.value,
      reason: isSameRunConflict
        ? `Conflicting observation for ${objectNameSingular}.${fieldName} (contradicts another observation from the same research run)`
        : `Conflicting observation for ${objectNameSingular}.${fieldName} (disagrees with the current fact)`,
    });

    return null;
  }

  // The single place FactDerivationService reaches into the proposal model.
  // ProposalCreationService.createFromExtraction is the non-agent entry point
  // into Proposal/ProposalItem — the same tables and the same AiWritePolicy
  // check a tool call goes through, just without a ToolProviderContext to key
  // a batch on. sourceKey is derived from evidence.id so a retried derivation
  // (see deriveFact's unique-violation retry) can never duplicate a proposal.
  private async proposeFieldChange(
    evidence: EvidenceEntity,
    params: { oldValue: unknown; reason: string },
  ): Promise<void> {
    const { workspaceId, objectNameSingular, recordId } = evidence;
    const { fieldName, value } = evidence.payload;

    const proposalCreationService = this.moduleRef.get(
      ProposalCreationService,
      { strict: false },
    );

    await proposalCreationService.createFromExtraction({
      workspaceId,
      sourceKey: `fact-derivation:${evidence.id}`,
      reason: params.reason,
      createdByActor: {
        source: FieldActorSource.AGENT,
        workspaceMemberId: null,
        name: 'Fact derivation',
        context: {},
      },
      items: [
        {
          actionType: ProposalActionType.UPDATE_RECORD,
          objectNameSingular,
          recordId,
          payload: { [fieldName]: value },
          baseline: isDefined(params.oldValue)
            ? { [fieldName]: params.oldValue }
            : {},
        },
      ],
    });
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
