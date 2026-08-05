import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { In, Repository } from 'typeorm';

import { CreateRecordService } from 'src/engine/core-modules/record-crud/services/create-record.service';
import { DeleteRecordService } from 'src/engine/core-modules/record-crud/services/delete-record.service';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { UpdateRecordService } from 'src/engine/core-modules/record-crud/services/update-record.service';
import { CreateCalendarEventTool } from 'src/engine/core-modules/tool/tools/calendar-tool/create-calendar-event-tool';
import { SendEmailTool } from 'src/engine/core-modules/tool/tools/email-tool/send-email-tool';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import {
  ProposalActionType,
  ProposalItemStatus,
  ProposalStatus,
} from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';
import { UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { type RolePermissionConfig } from 'src/engine/twenty-orm/types/role-permission-config';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

export type ApprovalResult = {
  proposalId: string;
  appliedItemIds: string[];
  conflictedItemIds: string[];
  failedItemIds: string[];
  aborted: boolean;
};

@Injectable()
export class ProposalExecutionService {
  private readonly logger = new Logger(ProposalExecutionService.name);

  constructor(
    private readonly findRecordsService: FindRecordsService,
    private readonly createRecordService: CreateRecordService,
    private readonly updateRecordService: UpdateRecordService,
    private readonly deleteRecordService: DeleteRecordService,
    private readonly userRoleService: UserRoleService,
    private readonly sendEmailTool: SendEmailTool,
    private readonly createCalendarEventTool: CreateCalendarEventTool,
    // Proposals are looked up by (id, workspaceId) as a single composite
    // condition, not workspaceId-then-filter, so the scoped wrapper's
    // "workspaceId first, merge rest" shape doesn't fit this access pattern.
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(ProposalEntity, 'core')
    private readonly proposalRepository: Repository<ProposalEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(ProposalItemEntity, 'core')
    private readonly proposalItemRepository: Repository<ProposalItemEntity>,
  ) {}

  async approve(params: {
    proposalId: string;
    selectedItemIds: string[];
    workspaceId: string;
    approverUserWorkspaceId: string;
  }): Promise<ApprovalResult> {
    const {
      proposalId,
      selectedItemIds,
      workspaceId,
      approverUserWorkspaceId,
    } = params;

    const proposal = await this.proposalRepository.findOne({
      where: { id: proposalId, workspaceId },
    });

    if (!isDefined(proposal) || proposal.status !== ProposalStatus.PENDING) {
      return this.emptyResult(proposalId, true);
    }

    if (proposal.expiresAt.getTime() < Date.now()) {
      await this.proposalRepository.save({
        ...proposal,
        status: ProposalStatus.EXPIRED,
      });

      return this.emptyResult(proposalId, true);
    }

    const items = await this.proposalItemRepository.find({
      where: { proposalId },
    });
    const selectedItems = items.filter((item) =>
      selectedItemIds.includes(item.id),
    );

    // Validate every selected item before writing anything. One stale baseline
    // aborts the batch — a partially applied change set is worse than none.
    const conflictedItemIds: string[] = [];

    for (const item of selectedItems) {
      const hasConflict = await this.hasBaselineConflict(item, workspaceId);

      if (hasConflict) {
        conflictedItemIds.push(item.id);
      }
    }

    if (conflictedItemIds.length > 0) {
      await this.proposalItemRepository.save(
        selectedItems.map((item) => ({
          ...item,
          status: ProposalItemStatus.CONFLICTED,
        })),
      );

      return {
        proposalId,
        appliedItemIds: [],
        conflictedItemIds: selectedItems.map((item) => item.id),
        failedItemIds: [],
        aborted: true,
      };
    }

    const roleId = await this.userRoleService.getRoleIdForUserWorkspace({
      userWorkspaceId: approverUserWorkspaceId,
      workspaceId,
    });

    const rolePermissionConfig: RolePermissionConfig = { unionOf: [roleId] };
    const appliedItemIds: string[] = [];
    const failedItemIds: string[] = [];

    // Record writes first. An outbound send cannot be undone, so it must never
    // fire ahead of a record write that might still fail.
    const isOutboundSend = (item: ProposalItemEntity) =>
      item.actionType === ProposalActionType.SEND_EMAIL ||
      item.actionType === ProposalActionType.CREATE_CALENDAR_EVENT;

    const orderedItems = [
      ...selectedItems.filter((item) => !isOutboundSend(item)),
      ...selectedItems.filter(isOutboundSend),
    ];

    for (const item of orderedItems) {
      const output = await this.applyItem(
        item,
        workspaceId,
        rolePermissionConfig,
        approverUserWorkspaceId,
      );

      if (output.success) {
        appliedItemIds.push(item.id);
        await this.proposalItemRepository.save({
          ...item,
          status: ProposalItemStatus.APPLIED,
        });
      } else {
        failedItemIds.push(item.id);
        await this.proposalItemRepository.save({
          ...item,
          status: ProposalItemStatus.FAILED,
          error: output.error ?? output.message,
        });
      }
    }

    const unselectedItems = items.filter(
      (item) => !selectedItemIds.includes(item.id),
    );

    for (const item of unselectedItems) {
      await this.proposalItemRepository.save({
        ...item,
        status: ProposalItemStatus.REJECTED,
      });
    }

    await this.proposalRepository.save({
      ...proposal,
      status: ProposalStatus.APPLIED,
      reviewedByUserWorkspaceId: approverUserWorkspaceId,
      reviewedAt: new Date(),
    });

    return {
      proposalId,
      appliedItemIds,
      conflictedItemIds: [],
      failedItemIds,
      aborted: false,
    };
  }

  async reject(params: {
    proposalId: string;
    workspaceId: string;
    approverUserWorkspaceId: string;
  }): Promise<ApprovalResult> {
    const { proposalId, workspaceId, approverUserWorkspaceId } = params;

    const proposal = await this.proposalRepository.findOne({
      where: { id: proposalId, workspaceId },
    });

    if (!isDefined(proposal) || proposal.status !== ProposalStatus.PENDING) {
      return this.emptyResult(proposalId, true);
    }

    const items = await this.proposalItemRepository.find({
      where: { proposalId, status: In([ProposalItemStatus.PENDING]) },
    });

    for (const item of items) {
      await this.proposalItemRepository.save({
        ...item,
        status: ProposalItemStatus.REJECTED,
      });
    }

    await this.proposalRepository.save({
      ...proposal,
      status: ProposalStatus.REJECTED,
      reviewedByUserWorkspaceId: approverUserWorkspaceId,
      reviewedAt: new Date(),
    });

    return this.emptyResult(proposalId, false);
  }

  // Compares the values captured when the proposal was made against the record
  // as it stands now. A human edit in between must not be silently overwritten.
  private async hasBaselineConflict(
    item: ProposalItemEntity,
    workspaceId: string,
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
      authContext: buildSystemAuthContext(workspaceId),
      rolePermissionConfig: { shouldBypassPermissionChecks: true },
    });

    const record = (output.result as { records?: Record<string, unknown>[] })
      ?.records?.[0];

    if (!isDefined(record)) {
      return true;
    }

    return baselineFieldNames.some(
      (fieldName) =>
        JSON.stringify(record[fieldName]) !==
        JSON.stringify(item.baseline[fieldName]),
    );
  }

  private async applyItem(
    item: ProposalItemEntity,
    workspaceId: string,
    rolePermissionConfig: RolePermissionConfig,
    approverUserWorkspaceId: string,
  ): Promise<ToolOutput> {
    const authContext = buildSystemAuthContext(workspaceId);
    const objectName = item.objectNameSingular ?? '';

    switch (item.actionType) {
      case ProposalActionType.CREATE_RECORD:
        return this.createRecordService.execute({
          objectName,
          objectRecord: item.payload,
          authContext,
          rolePermissionConfig,
          slimResponse: true,
        });

      case ProposalActionType.UPDATE_RECORD:
        return this.updateRecordService.execute({
          objectName,
          objectRecordId: item.recordId ?? '',
          objectRecord: item.payload,
          authContext,
          rolePermissionConfig,
          slimResponse: true,
        });

      case ProposalActionType.DELETE_RECORD:
        return this.deleteRecordService.execute({
          objectName,
          objectRecordId: item.recordId ?? '',
          authContext,
          rolePermissionConfig,
          soft: true,
        });

      // Outbound sends are external calls that cannot be rolled back, so the
      // apply loop orders them after every record write in the batch.
      case ProposalActionType.SEND_EMAIL:
        return this.sendEmailTool.execute(item.payload as never, {
          workspaceId,
          userWorkspaceId: approverUserWorkspaceId,
        });

      case ProposalActionType.CREATE_CALENDAR_EVENT:
        return this.createCalendarEventTool.execute(item.payload as never, {
          workspaceId,
          userWorkspaceId: approverUserWorkspaceId,
        });
    }
  }

  private emptyResult(proposalId: string, aborted: boolean): ApprovalResult {
    return {
      proposalId,
      appliedItemIds: [],
      conflictedItemIds: [],
      failedItemIds: [],
      aborted,
    };
  }
}
