import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'searm-shared/utils';
import { In, Not, Repository } from 'typeorm';

import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { FactService } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import {
  ProposalItemStatus,
  ProposalStatus,
  type ProposalSupersessionReason,
} from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';
import { buildSystemAuthContext } from 'src/engine/searm-orm/utils/build-system-auth-context.util';

export type SupersessionResult = {
  supersededItemIds: string[];
  supersededProposalIds: string[];
};

const EMPTY_RESULT: SupersessionResult = {
  supersededItemIds: [],
  supersededProposalIds: [],
};

// TTL expiry answers "nobody looked at this for a week". It does not answer
// "this stopped being true on Tuesday", which is the case a reviewer actually
// resents: approving a card that describes a world that has moved on.
//
// This is NOT a second approval mechanism. It writes no new table and adds no
// new state to reason about beyond one terminal status on the existing rows,
// mirroring FactStatus.SUPERSEDED exactly: the outgoing row keeps its payload,
// keeps its citations, records when and why it went, and points forward at its
// successor where there is one. Nothing is deleted, so the audit trail that
// makes this product accountable stays intact.
@Injectable()
export class ProposalSupersessionService {
  private readonly logger = new Logger(ProposalSupersessionService.name);

  constructor(
    private readonly factService: FactService,
    private readonly findRecordsService: FindRecordsService,
    // Composite (workspaceId, status) filters throughout, not
    // workspaceId-then-merge — same reason ProposalGateService and
    // ProposalExecutionService opt out of the scoped wrapper. Every query
    // below carries an explicit workspaceId.
    // eslint-disable-next-line searm/prefer-workspace-scoped-repository
    @InjectRepository(ProposalEntity)
    private readonly proposalRepository: Repository<ProposalEntity>,
    // eslint-disable-next-line searm/prefer-workspace-scoped-repository
    @InjectRepository(ProposalItemEntity)
    private readonly proposalItemRepository: Repository<ProposalItemEntity>,
  ) {}

  // Called right after a new proposal's items are written, by both doors into
  // the proposal model (the gate and ProposalCreationService). Supersedes
  // earlier pending items that target the same record and overlap on at least
  // one field: two cards proposing different values for person.jobTitle are
  // not two decisions, they are one decision with an obsolete draft attached.
  //
  // Field-level, not record-level, on purpose. A new proposal touching
  // person.city must not silently retire a pending person.jobTitle draft that
  // is still perfectly answerable.
  async supersedeOverlappingItems(params: {
    workspaceId: string;
    proposalId: string;
  }): Promise<SupersessionResult> {
    const { workspaceId, proposalId } = params;

    const newItems = await this.proposalItemRepository.find({
      where: { proposalId, status: ProposalItemStatus.PENDING },
    });

    const recordTargetedItems = newItems.filter(
      (item) => isDefined(item.objectNameSingular) && isDefined(item.recordId),
    );

    if (recordTargetedItems.length === 0) {
      return EMPTY_RESULT;
    }

    const olderItems = await this.findOtherPendingItems({
      workspaceId,
      excludedProposalId: proposalId,
      recordIds: [
        ...new Set(
          recordTargetedItems.map((item) => item.recordId as string),
        ),
      ],
    });

    const supersededItemIds: string[] = [];

    for (const older of olderItems) {
      const successor = recordTargetedItems.find(
        (candidate) =>
          candidate.objectNameSingular === older.objectNameSingular &&
          candidate.recordId === older.recordId &&
          this.hasFieldOverlap(candidate.payload, older.payload),
      );

      if (!isDefined(successor)) {
        continue;
      }

      await this.markItemSuperseded({
        itemId: older.id,
        reason: 'NEWER_PROPOSAL',
        supersededByProposalItemId: successor.id,
      });

      supersededItemIds.push(older.id);
    }

    const supersededProposalIds = await this.rollUpFullySupersededProposals(
      workspaceId,
      olderItems.map((item) => item.proposalId),
    );

    return { supersededItemIds, supersededProposalIds };
  }

  // The pull-based half: causes that happen elsewhere and never call us. A
  // human editing a record does not know a proposal exists, and
  // FactDerivationService cannot reach into this module without closing a
  // cycle (ai-write-approval already depends on ai-research). So the sweep
  // asks, rather than being told.
  //
  // Runs on the monitoring sweep tick, which already iterates workspaces.
  // Deliberately no cron of its own — a second scheduler for a check this
  // cheap is infrastructure nobody asked for.
  async sweepWorkspace(workspaceId: string): Promise<SupersessionResult> {
    const pendingProposals = await this.proposalRepository.find({
      where: { workspaceId, status: ProposalStatus.PENDING },
      relations: ['items'],
    });

    if (pendingProposals.length === 0) {
      return EMPTY_RESULT;
    }

    const authContext = buildSystemAuthContext(workspaceId);
    const supersededItemIds: string[] = [];

    for (const proposal of pendingProposals) {
      for (const item of proposal.items) {
        if (item.status !== ProposalItemStatus.PENDING) {
          continue;
        }

        const reason = await this.resolveSupersessionReason(
          workspaceId,
          item,
          authContext,
        );

        if (!isDefined(reason)) {
          continue;
        }

        await this.markItemSuperseded({
          itemId: item.id,
          reason,
          supersededByProposalItemId: null,
        });

        supersededItemIds.push(item.id);
      }
    }

    const supersededProposalIds = await this.rollUpFullySupersededProposals(
      workspaceId,
      pendingProposals.map((proposal) => proposal.id),
    );

    if (supersededItemIds.length > 0) {
      this.logger.log(
        `Superseded ${supersededItemIds.length} stale proposal item(s) in workspace ${workspaceId}`,
      );
    }

    return { supersededItemIds, supersededProposalIds };
  }

  // Evidence first, record second. A fact that has been superseded or
  // dismissed is the more specific explanation, and the reviewer is better
  // served by "the source changed" than by "the record changed" when both are
  // true — the record almost always changed *because* someone acted on the
  // newer source.
  private async resolveSupersessionReason(
    workspaceId: string,
    item: ProposalItemEntity,
    authContext: ReturnType<typeof buildSystemAuthContext>,
  ): Promise<ProposalSupersessionReason | null> {
    if (item.factIds.length > 0) {
      const nonCurrent = await this.factService.findNonCurrentFactIds(
        workspaceId,
        item.factIds,
      );

      // ALL of them, not any. A proposal citing three facts of which one was
      // dismissed still has two standing behind it, and retiring it would
      // throw away a reviewable change over a partial evidence loss.
      if (nonCurrent.length === item.factIds.length) {
        return 'FACT_SUPERSEDED';
      }
    }

    const drifted = await this.hasRecordDrifted(item, authContext);

    return drifted ? 'RECORD_CHANGED' : null;
  }

  // The same comparison ProposalExecutionService.hasBaselineConflict makes at
  // approval time, run early so the card leaves the inbox instead of being
  // offered, selected, and then aborting the whole batch as CONFLICTED.
  //
  // Read under the system context with checks bypassed. That is safe here and
  // nowhere near the write path: this decides only whether to retire a draft,
  // it can never widen what an approver is later allowed to apply, and the
  // approval path re-reads the baseline as the approver regardless.
  private async hasRecordDrifted(
    item: ProposalItemEntity,
    authContext: ReturnType<typeof buildSystemAuthContext>,
  ): Promise<boolean> {
    const baselineFieldNames = Object.keys(item.baseline);

    if (
      !isDefined(item.objectNameSingular) ||
      !isDefined(item.recordId) ||
      baselineFieldNames.length === 0
    ) {
      return false;
    }

    const output = await this.findRecordsService.execute({
      objectName: item.objectNameSingular,
      filter: { id: { eq: item.recordId } },
      limit: 1,
      select: baselineFieldNames,
      shouldBuildEffectiveSelectFields: true,
      authContext,
      rolePermissionConfig: { shouldBypassPermissionChecks: true },
    });

    // record-crud never throws — it returns { success: false }. Treating a
    // failed read as drift would retire good proposals on a transient error,
    // so an unreadable record is left alone for the next tick.
    if (!output.success) {
      return false;
    }

    const record = (output.result as { records?: Record<string, unknown>[] })
      ?.records?.[0];

    // Deleted underneath the draft. There is no record left to update, so the
    // question the card asks cannot be answered.
    if (!isDefined(record)) {
      return true;
    }

    return baselineFieldNames.some(
      (fieldName) =>
        JSON.stringify(record[fieldName]) !==
        JSON.stringify(item.baseline[fieldName]),
    );
  }

  // Guarded on status = PENDING inside the UPDATE: a concurrent approval that
  // already moved the item to APPLYING/APPLIED must win. Supersession never
  // retracts a change a human is in the middle of approving.
  private async markItemSuperseded(params: {
    itemId: string;
    reason: ProposalSupersessionReason;
    supersededByProposalItemId: string | null;
  }): Promise<void> {
    await this.proposalItemRepository
      .createQueryBuilder()
      .update()
      .set({
        status: ProposalItemStatus.SUPERSEDED,
        supersededAt: new Date(),
        supersessionReason: params.reason,
        supersededByProposalItemId: params.supersededByProposalItemId,
      })
      .where('id = :id', { id: params.itemId })
      .andWhere('status = :pending', { pending: ProposalItemStatus.PENDING })
      .execute();
  }

  // A proposal with one live item left is still a card worth showing. Only
  // when nothing underneath is answerable does the envelope itself retire.
  private async rollUpFullySupersededProposals(
    workspaceId: string,
    candidateProposalIds: string[],
  ): Promise<string[]> {
    const uniqueIds = [...new Set(candidateProposalIds)];

    if (uniqueIds.length === 0) {
      return [];
    }

    const proposals = await this.proposalRepository.find({
      where: {
        id: In(uniqueIds),
        workspaceId,
        status: ProposalStatus.PENDING,
      },
      relations: ['items'],
    });

    const supersededProposalIds: string[] = [];

    for (const proposal of proposals) {
      const hasLiveItem = proposal.items.some(
        (item) => item.status === ProposalItemStatus.PENDING,
      );

      // No items at all means the proposal envelope was created but every
      // item was suppressed by policy. Leave it to TTL rather than claiming
      // a supersession that never happened.
      if (hasLiveItem || proposal.items.length === 0) {
        continue;
      }

      const result = await this.proposalRepository
        .createQueryBuilder()
        .update()
        .set({
          status: ProposalStatus.SUPERSEDED,
          supersededAt: new Date(),
        })
        .where('id = :id', { id: proposal.id })
        .andWhere('"workspaceId" = :workspaceId', { workspaceId })
        .andWhere('status = :pending', { pending: ProposalStatus.PENDING })
        .execute();

      if ((result.affected ?? 0) > 0) {
        supersededProposalIds.push(proposal.id);
      }
    }

    return supersededProposalIds;
  }

  private async findOtherPendingItems(params: {
    workspaceId: string;
    excludedProposalId: string;
    recordIds: string[];
  }): Promise<ProposalItemEntity[]> {
    const otherPendingProposals = await this.proposalRepository.find({
      where: {
        workspaceId: params.workspaceId,
        status: ProposalStatus.PENDING,
        id: Not(params.excludedProposalId),
      },
      select: ['id'],
    });

    if (otherPendingProposals.length === 0) {
      return [];
    }

    return this.proposalItemRepository.find({
      where: {
        proposalId: In(otherPendingProposals.map((proposal) => proposal.id)),
        status: ProposalItemStatus.PENDING,
        recordId: In(params.recordIds),
      },
      order: { createdAt: 'ASC' },
    });
  }

  private hasFieldOverlap(
    successorPayload: Record<string, unknown>,
    olderPayload: Record<string, unknown>,
  ): boolean {
    const successorFields = new Set(Object.keys(successorPayload));

    return Object.keys(olderPayload).some((field) =>
      successorFields.has(field),
    );
  }
}
