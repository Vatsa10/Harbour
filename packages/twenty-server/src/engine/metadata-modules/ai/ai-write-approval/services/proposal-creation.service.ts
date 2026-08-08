import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { Repository } from 'typeorm';

import { FactService } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import { AiWritePolicyService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/ai-write-policy.service';
import {
  type CreateFromExtractionInput,
  type CreateFromExtractionResult,
} from 'src/engine/metadata-modules/ai/ai-write-approval/types/extraction-proposal.type';
import {
  PROPOSAL_TTL_DAYS,
  ProposalItemStatus,
  ProposalStatus,
} from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';

// The non-agent entry point into the proposal model. Background jobs
// (ingestion extraction, guided import) have no ToolProviderContext to key a
// batch on, so ProposalGateService.evaluate() cannot serve them — but they are
// AI-originated writes and must not reach a CRM record without human approval.
// This is a second door into the SAME Proposal/ProposalItem tables and the
// SAME AiWritePolicyService, deliberately not a second approval system.
@Injectable()
export class ProposalCreationService {
  constructor(
    private readonly aiWritePolicyService: AiWritePolicyService,
    private readonly factService: FactService,
    // Looked up by (workspaceId, sourceKey) as a single composite condition,
    // which the scoped wrapper's "workspaceId first, merge rest" shape does
    // not fit — same reason ProposalGateService opts out.
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(ProposalEntity)
    private readonly proposalRepository: Repository<ProposalEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(ProposalItemEntity)
    private readonly proposalItemRepository: Repository<ProposalItemEntity>,
  ) {}

  // Idempotent on sourceKey: a job retried by BullMQ after a crash must not
  // create a second proposal for the same source. Returns null when nothing
  // reviewable was created (no items, retry, or policy suppression).
  async createFromExtraction(
    params: CreateFromExtractionInput,
  ): Promise<CreateFromExtractionResult | null> {
    const { workspaceId, sourceKey, reason, createdByActor, items } = params;

    if (items.length === 0) {
      return null;
    }

    const existing = await this.proposalRepository.findOne({
      where: { workspaceId, sourceKey },
    });

    if (isDefined(existing)) {
      return null;
    }

    // An ingestion/import write is AI-originated the same way a tool call is,
    // so a workspace FORBID must suppress it here too — otherwise the
    // workspace's own "never touch this" instruction only holds on the
    // evaluate() path. Same lookup evaluate() makes.
    const policy = await this.aiWritePolicyService.getPolicy(workspaceId);
    const allowedItems = items.filter(
      (item) =>
        this.aiWritePolicyService.resolveMode(policy, {
          kind: 'record',
          objectNameSingular: item.objectNameSingular,
          fieldNames: Object.keys(item.payload),
        }) !== 'FORBID',
    );

    if (allowedItems.length === 0) {
      return null;
    }

    const expiresAt = new Date();

    expiresAt.setDate(expiresAt.getDate() + PROPOSAL_TTL_DAYS);

    const proposal = await this.proposalRepository.save({
      workspaceId,
      sourceKey,
      // No agent turn behind a background job, so there is no thread to batch
      // on; sourceKey is what correlates the batch instead.
      threadId: null,
      createdByActor,
      reason,
      status: ProposalStatus.PENDING,
      expiresAt,
    });

    const itemIds: string[] = [];

    for (const item of allowedItems) {
      // Same provenance attachment evaluate() does, so a background-job
      // proposal is as citable in the review UI as an agent's. Read-only.
      const factIds = isDefined(item.recordId)
        ? await this.factService.findCurrentFactIdsForFields({
            workspaceId,
            objectNameSingular: item.objectNameSingular,
            recordId: item.recordId,
            fieldNames: Object.keys(item.payload),
          })
        : [];

      const savedItem = await this.proposalItemRepository.save({
        proposalId: proposal.id,
        actionType: item.actionType,
        objectNameSingular: item.objectNameSingular,
        recordId: item.recordId,
        payload: item.payload,
        baseline: item.baseline,
        factIds,
        status: ProposalItemStatus.PENDING,
      });

      itemIds.push(savedItem.id);
    }

    return { proposalId: proposal.id, itemIds };
  }
}
