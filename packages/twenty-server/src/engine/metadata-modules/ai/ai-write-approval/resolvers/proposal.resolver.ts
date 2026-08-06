import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';
import { InjectRepository } from '@nestjs/typeorm';

import { PermissionFlagType } from 'twenty-shared/constants';
import { Repository } from 'typeorm';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { AuthUserWorkspaceId } from 'src/engine/decorators/auth/auth-user-workspace-id.decorator';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import {
  ApproveProposalInput,
  RejectProposalInput,
} from 'src/engine/metadata-modules/ai/ai-write-approval/dtos/approve-proposal.input';
import {
  ApprovalResultDTO,
  ProposalDTO,
} from 'src/engine/metadata-modules/ai/ai-write-approval/dtos/proposal.dto';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import { ProposalExecutionService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-execution.service';
import { ProposalStatus } from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';

@UseGuards(WorkspaceAuthGuard, SettingsPermissionGuard(PermissionFlagType.AI))
@MetadataResolver()
export class ProposalResolver {
  constructor(
    private readonly proposalExecutionService: ProposalExecutionService,
    // Proposals are looked up by (workspaceId, status) as a composite filter,
    // not workspaceId-then-merge, so the scoped wrapper doesn't fit here.
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(ProposalEntity)
    private readonly proposalRepository: Repository<ProposalEntity>,
  ) {}

  // Expiry is computed here rather than enforced by a background job.
  @Query(() => [ProposalDTO])
  async pendingProposals(
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<ProposalDTO[]> {
    const proposals = await this.proposalRepository.find({
      where: {
        workspaceId: workspace.id,
        status: ProposalStatus.PENDING,
      },
      relations: ['items'],
      order: { createdAt: 'DESC' },
    });

    const now = new Date();

    return proposals
      .filter((proposal) => proposal.expiresAt > now)
      .map((proposal) => ({
        id: proposal.id,
        status: proposal.status,
        expiresAt: proposal.expiresAt,
        createdAt: proposal.createdAt,
        items: proposal.items.map((item) => ({
          id: item.id,
          actionType: item.actionType,
          objectNameSingular: item.objectNameSingular,
          recordId: item.recordId,
          toolId: item.toolId,
          payload: item.payload,
          baseline: item.baseline,
          status: item.status,
          error: item.error,
        })),
      }));
  }

  @Mutation(() => ApprovalResultDTO)
  async approveProposal(
    @Args('input') input: ApproveProposalInput,
    @AuthWorkspace() workspace: FlatWorkspace,
    @AuthUserWorkspaceId() userWorkspaceId: string,
  ): Promise<ApprovalResultDTO> {
    return this.proposalExecutionService.approve({
      proposalId: input.proposalId,
      selectedItemIds: input.selectedItemIds,
      workspaceId: workspace.id,
      approverUserWorkspaceId: userWorkspaceId,
    });
  }

  @Mutation(() => ApprovalResultDTO)
  async rejectProposal(
    @Args('input') input: RejectProposalInput,
    @AuthWorkspace() workspace: FlatWorkspace,
    @AuthUserWorkspaceId() userWorkspaceId: string,
  ): Promise<ApprovalResultDTO> {
    return this.proposalExecutionService.reject({
      proposalId: input.proposalId,
      workspaceId: workspace.id,
      approverUserWorkspaceId: userWorkspaceId,
    });
  }
}
