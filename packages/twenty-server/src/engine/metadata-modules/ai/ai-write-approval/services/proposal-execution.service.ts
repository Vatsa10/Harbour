import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';

import { PermissionFlagType } from 'twenty-shared/constants';
import { FieldActorSource, type ActorMetadata } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { canObjectBeManagedByAutomation } from 'twenty-shared/workflow';
import { In, Repository } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { buildUserAuthContext } from 'src/engine/core-modules/auth/utils/build-user-auth-context.util';
import { CreateManyRecordsService } from 'src/engine/core-modules/record-crud/services/create-many-records.service';
import { CreateRecordService } from 'src/engine/core-modules/record-crud/services/create-record.service';
import { DeleteManyRecordsService } from 'src/engine/core-modules/record-crud/services/delete-many-records.service';
import { DeleteRecordService } from 'src/engine/core-modules/record-crud/services/delete-record.service';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { UpdateManyRecordsService } from 'src/engine/core-modules/record-crud/services/update-many-records.service';
import { UpdateRecordService } from 'src/engine/core-modules/record-crud/services/update-record.service';
import { UpsertManyRecordsService } from 'src/engine/core-modules/record-crud/services/upsert-many-records.service';
import { TOOL_PROVIDERS } from 'src/engine/core-modules/tool-provider/constants/tool-providers.token';
import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { type ToolProvider } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider.interface';
import { CreateCalendarEventTool } from 'src/engine/core-modules/tool/tools/calendar-tool/create-calendar-event-tool';
import { SendEmailTool } from 'src/engine/core-modules/tool/tools/email-tool/send-email-tool';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { fromUserEntityToFlat } from 'src/engine/core-modules/user/utils/from-user-entity-to-flat.util';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { FactService } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import {
  ProposalActionType,
  ProposalItemStatus,
  ProposalStatus,
} from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';
import { PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';
import { UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { type RolePermissionConfig } from 'src/engine/twenty-orm/types/role-permission-config';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

// Why an item failed, carried back to the caller. Without it an approver sees
// only an id in failedItemIds and has nothing to act on, and the reason is
// buried in a row nobody queries.
export type ApprovalFailure = {
  itemId: string;
  error: string;
};

export type ApprovalResult = {
  proposalId: string;
  appliedItemIds: string[];
  conflictedItemIds: string[];
  // Items the approving user is not permitted to see, kept apart from
  // conflictedItemIds so the reviewer is told the truth about why.
  outOfScopeItemIds: string[];
  failedItemIds: string[];
  failures: ApprovalFailure[];
  aborted: boolean;
};

// Everything an item needs to be applied as the approver rather than as SYSTEM.
type ApproverContext = {
  authContext: WorkspaceAuthContext;
  rolePermissionConfig: RolePermissionConfig;
  actorMetadata: ActorMetadata;
  workspaceId: string;
  userId: string;
  userWorkspaceId: string;
  roleId: string;
};

const OUTBOUND_TOOL_PERMISSION_FLAGS: Partial<
  Record<ProposalActionType, PermissionFlagType>
> = {
  [ProposalActionType.SEND_EMAIL]: PermissionFlagType.SEND_EMAIL_TOOL,
  [ProposalActionType.CREATE_CALENDAR_EVENT]:
    PermissionFlagType.CREATE_CALENDAR_EVENT_TOOL,
};

@Injectable()
export class ProposalExecutionService {
  private readonly logger = new Logger(ProposalExecutionService.name);

  constructor(
    private readonly findRecordsService: FindRecordsService,
    private readonly createRecordService: CreateRecordService,
    private readonly createManyRecordsService: CreateManyRecordsService,
    private readonly updateRecordService: UpdateRecordService,
    private readonly updateManyRecordsService: UpdateManyRecordsService,
    private readonly upsertManyRecordsService: UpsertManyRecordsService,
    private readonly deleteRecordService: DeleteRecordService,
    private readonly deleteManyRecordsService: DeleteManyRecordsService,
    private readonly userRoleService: UserRoleService,
    private readonly factService: FactService,
    private readonly permissionsService: PermissionsService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly sendEmailTool: SendEmailTool,
    private readonly createCalendarEventTool: CreateCalendarEventTool,
    // Static-tool items are replayed through the provider that owns them.
    // ToolProviderModule imports this module, so the provider list is resolved
    // lazily rather than injected, which would close a module cycle.
    private readonly moduleRef: ModuleRef,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
    // Proposals are looked up by (id, workspaceId) as a single composite
    // condition, not workspaceId-then-filter, so the scoped wrapper's
    // "workspaceId first, merge rest" shape doesn't fit this access pattern.
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(ProposalEntity)
    private readonly proposalRepository: Repository<ProposalEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(ProposalItemEntity)
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
      await this.proposalRepository.update(
        { id: proposalId, workspaceId, status: ProposalStatus.PENDING },
        { status: ProposalStatus.EXPIRED },
      );

      return this.emptyResult(proposalId, true);
    }

    // Claim the proposal before doing any work. A concurrent approval finds
    // the row no longer PENDING, updates zero rows, and bails — so an item is
    // never applied (or an email sent) twice.
    const claim = await this.proposalRepository.update(
      { id: proposalId, workspaceId, status: ProposalStatus.PENDING },
      { status: ProposalStatus.APPLYING },
    );

    if (claim.affected === 0) {
      return this.emptyResult(proposalId, true);
    }

    try {
      return await this.applyClaimedProposal({
        proposalId,
        selectedItemIds,
        workspaceId,
        approverUserWorkspaceId,
      });
    } catch (error) {
      // Never leave a proposal stuck in APPLYING because of an unexpected throw.
      await this.proposalRepository.update(
        { id: proposalId, workspaceId, status: ProposalStatus.APPLYING },
        { status: ProposalStatus.FAILED },
      );

      throw error;
    }
  }

  private async applyClaimedProposal(params: {
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

    const items = await this.proposalItemRepository.find({
      where: { proposalId },
    });
    const selectedItems = items.filter((item) =>
      selectedItemIds.includes(item.id),
    );

    const approver = await this.buildApproverContext(
      workspaceId,
      approverUserWorkspaceId,
    );

    // Scope first, conflict second. hasBaselineConflict reports an empty read
    // as a conflict, and under record scope an empty read now has two causes:
    // the row is gone, or the approver may not see it. Running the scope
    // pre-flight first is what keeps the second cause from being mislabelled
    // as "the record changed" - advice a reviewer cannot act on for a record
    // they are not allowed to open.
    const conflictedItemIds: string[] = [];
    const outOfScopeItemIds: string[] = [];

    for (const item of selectedItems) {
      const { exists, visible } = await this.isItemWithinApproverScope(
        item,
        approver,
      );

      if (exists && !visible) {
        outOfScopeItemIds.push(item.id);
      }
    }

    if (outOfScopeItemIds.length > 0) {
      await this.proposalItemRepository.update(
        { id: In(outOfScopeItemIds) },
        { status: ProposalItemStatus.OUT_OF_SCOPE },
      );

      await this.proposalRepository.update(
        { id: proposalId, workspaceId, status: ProposalStatus.APPLYING },
        { status: ProposalStatus.PENDING },
      );

      // The whole batch aborts rather than applying the visible half. Silently
      // applying part of an agent's plan would hand a narrow-scoped approver a
      // way to split it with nobody seeing which half went through.
      return {
        proposalId,
        appliedItemIds: [],
        conflictedItemIds: [],
        outOfScopeItemIds,
        failedItemIds: [],
        failures: [],
        aborted: true,
      };
    }

    // Validate every selected item before writing anything. One stale baseline
    // aborts the batch — a partially applied change set is worse than none.
    for (const item of selectedItems) {
      const hasConflict = await this.hasBaselineConflict(item, approver);

      if (hasConflict) {
        conflictedItemIds.push(item.id);
      }
    }

    if (conflictedItemIds.length > 0) {
      // Only the items that actually went stale are marked, so the reviewer
      // sees exactly what changed. The proposal returns to PENDING so the
      // clean items stay reviewable.
      await this.proposalItemRepository.update(
        { id: In(conflictedItemIds) },
        { status: ProposalItemStatus.CONFLICTED },
      );

      await this.proposalRepository.update(
        { id: proposalId, workspaceId, status: ProposalStatus.APPLYING },
        { status: ProposalStatus.PENDING },
      );

      return {
        proposalId,
        appliedItemIds: [],
        conflictedItemIds,
        outOfScopeItemIds: [],
        failedItemIds: [],
        failures: [],
        aborted: true,
      };
    }

    const appliedItemIds: string[] = [];
    const failedItemIds: string[] = [];
    const failures: ApprovalFailure[] = [];

    // Record writes first. An outbound send cannot be undone, so it must never
    // fire ahead of a record write that might still fail.
    const isExternalCall = (item: ProposalItemEntity) =>
      item.actionType === ProposalActionType.SEND_EMAIL ||
      item.actionType === ProposalActionType.CREATE_CALENDAR_EVENT ||
      item.actionType === ProposalActionType.STATIC_TOOL;

    const orderedItems = [
      ...selectedItems.filter((item) => !isExternalCall(item)),
      ...selectedItems.filter(isExternalCall),
    ];

    for (const item of orderedItems) {
      const output = await this.applyItem(item, approver);

      if (output.success) {
        appliedItemIds.push(item.id);
        await this.proposalItemRepository.update(
          { id: item.id },
          {
            status: ProposalItemStatus.APPLIED,
            resultRecordId: this.extractResultRecordId(output),
          },
        );
      } else {
        const error =
          output.error ?? output.message ?? 'Unknown proposal item failure';

        failedItemIds.push(item.id);
        failures.push({ itemId: item.id, error });

        // A silent failure here reads as "approval did nothing" in the UI.
        this.logger.error(
          `Proposal item ${item.id} (${item.actionType} ${item.objectNameSingular ?? item.toolId}) failed: ${error}`,
        );

        await this.proposalItemRepository.update(
          { id: item.id },
          {
            status: ProposalItemStatus.FAILED,
            error,
          },
        );
      }
    }

    const unselectedItems = items.filter(
      (item) => !selectedItemIds.includes(item.id),
    );

    if (unselectedItems.length > 0) {
      await this.proposalItemRepository.update(
        { id: In(unselectedItems.map((item) => item.id)) },
        { status: ProposalItemStatus.REJECTED },
      );
    }

    // A reviewer deselecting an item is an explicit "no" to that exact
    // value — the facts that justified it must not be re-proposed. The
    // entities are kept (rather than mapping straight to ids) because
    // factIds lives on them and re-querying would be a second round trip.
    await this.factService.markDismissed(
      workspaceId,
      unselectedItems.flatMap((item) => item.factIds),
    );

    await this.proposalRepository.update(
      { id: proposalId, workspaceId },
      {
        status: this.resolveFinalStatus(appliedItemIds, failedItemIds),
        reviewedByUserWorkspaceId: approverUserWorkspaceId,
        reviewedAt: new Date(),
      },
    );

    return {
      proposalId,
      appliedItemIds,
      conflictedItemIds: [],
      outOfScopeItemIds: [],
      failedItemIds,
      failures,
      aborted: false,
    };
  }

  // The stored status must describe what actually happened: a batch whose every
  // item failed is not APPLIED, and one nobody selected is REJECTED.
  private resolveFinalStatus(
    appliedItemIds: string[],
    failedItemIds: string[],
  ): ProposalStatus {
    if (failedItemIds.length === 0) {
      return appliedItemIds.length > 0
        ? ProposalStatus.APPLIED
        : ProposalStatus.REJECTED;
    }

    return appliedItemIds.length > 0
      ? ProposalStatus.PARTIALLY_APPLIED
      : ProposalStatus.FAILED;
  }

  private extractResultRecordId(output: ToolOutput): string | null {
    const record = (output.result as { record?: { id?: unknown } } | undefined)
      ?.record;

    return typeof record?.id === 'string' ? record.id : null;
  }

  async reject(params: {
    proposalId: string;
    workspaceId: string;
    approverUserWorkspaceId: string;
  }): Promise<ApprovalResult> {
    const { proposalId, workspaceId, approverUserWorkspaceId } = params;

    const rejection = await this.proposalRepository.update(
      { id: proposalId, workspaceId, status: ProposalStatus.PENDING },
      {
        status: ProposalStatus.REJECTED,
        reviewedByUserWorkspaceId: approverUserWorkspaceId,
        reviewedAt: new Date(),
      },
    );

    if (rejection.affected === 0) {
      return this.emptyResult(proposalId, true);
    }

    // CONFLICTED items are rejectable too: an aborted batch left them in a
    // terminal-looking state that reject() previously could never clear.
    const openStatuses = [
      ProposalItemStatus.PENDING,
      ProposalItemStatus.CONFLICTED,
    ];

    // Load before updating: after the update nothing is PENDING or
    // CONFLICTED any more, and factIds only exists on the rows themselves.
    // This is a read reject() did not previously do.
    const rejectedItems = await this.proposalItemRepository.find({
      where: { proposalId, status: In(openStatuses) },
    });

    await this.proposalItemRepository.update(
      { proposalId, status: In(openStatuses) },
      { status: ProposalItemStatus.REJECTED },
    );

    await this.factService.markDismissed(
      workspaceId,
      rejectedItems.flatMap((item) => item.factIds),
    );

    return this.emptyResult(proposalId, false);
  }

  // Runs as the approver so object and field permissions are enforced by the
  // ordinary ORM path, and so createdBy/updatedBy names the human who approved.
  private async buildApproverContext(
    workspaceId: string,
    approverUserWorkspaceId: string,
  ): Promise<ApproverContext> {
    const userWorkspace = await this.userWorkspaceRepository.findOne({
      where: { id: approverUserWorkspaceId, workspaceId },
    });

    if (!isDefined(userWorkspace)) {
      throw new Error(
        `Approver user workspace ${approverUserWorkspaceId} not found`,
      );
    }

    const user = await this.userRepository.findOne({
      where: { id: userWorkspace.userId },
    });

    if (!isDefined(user)) {
      throw new Error(`Approver user ${userWorkspace.userId} not found`);
    }

    const { flatWorkspaceMemberMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatWorkspaceMemberMaps',
      ]);

    const workspaceMemberId = flatWorkspaceMemberMaps.idByUserId[user.id];
    const workspaceMember = isDefined(workspaceMemberId)
      ? flatWorkspaceMemberMaps.byId[workspaceMemberId]
      : undefined;

    if (!isDefined(workspaceMemberId) || !isDefined(workspaceMember)) {
      throw new Error(
        `Approver workspace member not found for user ${user.id}`,
      );
    }

    const roleId = await this.userRoleService.getRoleIdForUserWorkspace({
      userWorkspaceId: approverUserWorkspaceId,
      workspaceId,
    });

    return {
      authContext: buildUserAuthContext({
        workspace: { id: workspaceId } as FlatWorkspace,
        userWorkspaceId: approverUserWorkspaceId,
        user: fromUserEntityToFlat(user),
        workspaceMemberId,
        workspaceMember,
      }),
      rolePermissionConfig: { unionOf: [roleId] },
      actorMetadata: {
        source: FieldActorSource.MANUAL,
        workspaceMemberId,
        name: [user.firstName, user.lastName].filter(Boolean).join(' '),
        context: {},
      },
      workspaceId,
      userId: user.id,
      userWorkspaceId: approverUserWorkspaceId,
      roleId,
    };
  }

  // Distinguishes "the row is gone" from "the row is invisible to you". The
  // second read uses bypass, but converts it into a single boolean - no field
  // value ever crosses back - so it answers the scope question without itself
  // becoming a scope hole.
  private async isItemWithinApproverScope(
    item: ProposalItemEntity,
    approver: ApproverContext,
  ): Promise<{ exists: boolean; visible: boolean }> {
    const { objectNameSingular, recordId } = item;

    // Outbound sends and static-tool items target no record, and a create has
    // no pre-existing row to be scoped out of. Those are governed by tool
    // permission flags at applyOutboundSend / applyStaticTool, not by scope.
    if (!isDefined(objectNameSingular) || !isDefined(recordId)) {
      return { exists: true, visible: true };
    }

    const canReadRecord = async (
      authContext: WorkspaceAuthContext,
      rolePermissionConfig: RolePermissionConfig,
    ) => {
      const output = await this.findRecordsService.execute({
        objectName: objectNameSingular,
        filter: { id: { eq: recordId } },
        limit: 1,
        select: ['id'],
        shouldBuildEffectiveSelectFields: true,
        authContext,
        rolePermissionConfig,
      });

      return isDefined(
        (output.result as { records?: { id: string }[] })?.records?.[0],
      );
    };

    const visible = await canReadRecord(
      approver.authContext,
      approver.rolePermissionConfig,
    );

    if (visible) {
      return { exists: true, visible: true };
    }

    const exists = await canReadRecord(
      buildSystemAuthContext(approver.workspaceId),
      { shouldBypassPermissionChecks: true },
    );

    return { exists, visible: false };
  }

  // Compares the values captured when the proposal was made against the record
  // as it stands now. A human edit in between must not be silently overwritten.
  private async hasBaselineConflict(
    item: ProposalItemEntity,
    approver: ApproverContext,
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
      authContext: approver.authContext,
      // Same role config on both sides of the comparison. Re-reading under a
      // wider config than the baseline was captured with flips the comparison.
      rolePermissionConfig: approver.rolePermissionConfig,
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
    approver: ApproverContext,
  ): Promise<ToolOutput> {
    const objectName = item.objectNameSingular ?? '';
    const { authContext, rolePermissionConfig, actorMetadata } = approver;
    const records = Array.isArray(item.payload.records)
      ? (item.payload.records as Record<string, unknown>[])
      : [];
    const filter = (item.payload.filter ?? {}) as Record<string, unknown>;

    // record-crud refuses every write to an object on the automation
    // blocklist (messageParticipant, calendarEventParticipant, message, ...).
    // That blocklist exists to stop *unattended automations* rewriting
    // ingestion-owned rows; an approved proposal is the opposite case — a
    // named human pressed approve, and the write runs as them. Without this
    // branch every ingestion identity proposal is approvable but never
    // appliable: it lands in failedItemIds and the link never happens.
    if (
      isDefined(item.objectNameSingular) &&
      !canObjectBeManagedByAutomation({ nameSingular: item.objectNameSingular })
    ) {
      return this.applyAutomationBlockedRecordWrite(item, approver);
    }

    switch (item.actionType) {
      case ProposalActionType.CREATE_RECORD:
        return this.createRecordService.execute({
          objectName,
          objectRecord: item.payload,
          authContext,
          rolePermissionConfig,
          createdBy: actorMetadata,
          slimResponse: true,
        });

      case ProposalActionType.CREATE_RECORDS:
        return this.createManyRecordsService.execute({
          objectName,
          objectRecords: records,
          authContext,
          rolePermissionConfig,
          createdBy: actorMetadata,
          slimResponse: true,
        });

      case ProposalActionType.UPSERT_RECORDS:
        return this.upsertManyRecordsService.execute({
          objectName,
          objectRecords: records,
          authContext,
          rolePermissionConfig,
          createdBy: actorMetadata,
          slimResponse: true,
        });

      case ProposalActionType.UPDATE_RECORD:
        return this.updateRecordService.execute({
          objectName,
          objectRecordId: item.recordId ?? '',
          objectRecord: item.payload,
          authContext,
          rolePermissionConfig,
          updatedBy: actorMetadata,
          slimResponse: true,
        });

      case ProposalActionType.UPDATE_RECORDS:
        return this.updateManyRecordsService.execute({
          objectName,
          filter,
          data: (item.payload.data ?? {}) as Record<string, unknown>,
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

      case ProposalActionType.DELETE_RECORDS:
        return this.deleteManyRecordsService.execute({
          objectName,
          filter,
          authContext,
          rolePermissionConfig,
        });

      // Outbound sends are external calls that cannot be rolled back, so the
      // apply loop orders them after every record write in the batch.
      case ProposalActionType.SEND_EMAIL:
      case ProposalActionType.CREATE_CALENDAR_EVENT:
        return this.applyOutboundSend(item, approver);

      case ProposalActionType.STATIC_TOOL:
        return this.applyStaticTool(item, approver);
    }
  }

  // Applies a record write to an automation-blocked object. It still goes
  // through UpdateRecordService — so the update event fires, updatedBy is
  // stamped, composite fields are formatted, and object/field permissions are
  // enforced under the approver's role — carrying `isHumanApproved` to tell
  // record-crud that a named human, not an unattended automation, authorised
  // this. Deliberately narrow: only single-record updates on an existing row,
  // which is the whole shape ingestion proposals produce. Anything else stays
  // refused, with a message that says why rather than a bare failure.
  private async applyAutomationBlockedRecordWrite(
    item: ProposalItemEntity,
    approver: ApproverContext,
  ): Promise<ToolOutput> {
    const objectName = item.objectNameSingular ?? '';

    if (
      item.actionType !== ProposalActionType.UPDATE_RECORD ||
      !isDefined(item.recordId)
    ) {
      return {
        success: false,
        message: `Cannot apply this change to ${objectName}`,
        error: `"${objectName}" is blocked from automated writes; only single-record updates of an existing row may be approved on it, not ${item.actionType}.`,
      };
    }

    return this.updateRecordService.execute({
      objectName,
      objectRecordId: item.recordId,
      objectRecord: item.payload,
      authContext: approver.authContext,
      rolePermissionConfig: approver.rolePermissionConfig,
      updatedBy: approver.actorMetadata,
      isHumanApproved: true,
      slimResponse: true,
    });
  }

  // The dispatch path re-checks tool permissions before every static tool.
  // Approval must do the same, or an approver without the tool permission
  // dispatches a send the agent proposed.
  private async applyOutboundSend(
    item: ProposalItemEntity,
    approver: ApproverContext,
  ): Promise<ToolOutput> {
    const flag = OUTBOUND_TOOL_PERMISSION_FLAGS[item.actionType];

    if (isDefined(flag)) {
      const isPermitted = await this.permissionsService.hasToolPermission(
        approver.rolePermissionConfig,
        approver.workspaceId,
        flag,
      );

      if (!isPermitted) {
        return {
          success: false,
          message: 'Approver lacks permission for this tool',
          error: `The approver does not hold the ${flag} permission required to execute this item.`,
        };
      }
    }

    const tool =
      item.actionType === ProposalActionType.SEND_EMAIL
        ? this.sendEmailTool
        : this.createCalendarEventTool;

    // These tools accept no idempotency key; the single-claim guard on the
    // proposal is what prevents a double send.
    return tool.execute(item.payload as never, {
      workspaceId: approver.workspaceId,
      userId: approver.userId,
      userWorkspaceId: approver.userWorkspaceId,
    });
  }

  private async applyStaticTool(
    item: ProposalItemEntity,
    approver: ApproverContext,
  ): Promise<ToolOutput> {
    if (!isDefined(item.toolId) || !isDefined(item.toolCategory)) {
      return {
        success: false,
        message: 'Static tool item is missing its tool identity',
        error: `Proposal item ${item.id} cannot be replayed: no toolId/toolCategory was recorded.`,
      };
    }

    const providers = this.moduleRef.get<ToolProvider[]>(TOOL_PROVIDERS, {
      strict: false,
    });

    const provider = providers.find(
      (candidate) => candidate.category === item.toolCategory,
    );

    if (!isDefined(provider)) {
      return {
        success: false,
        message: 'No provider for this proposed tool',
        error: `No tool provider is registered for category "${item.toolCategory}".`,
      };
    }

    const context: ToolProviderContext = {
      workspaceId: approver.workspaceId,
      roleId: approver.roleId,
      rolePermissionConfig: approver.rolePermissionConfig,
      authContext: approver.authContext,
      actorContext: approver.actorMetadata,
      userId: approver.userId,
      userWorkspaceId: approver.userWorkspaceId,
    };

    // The same availability re-check the dispatch path performs, evaluated
    // against the approver rather than the agent that proposed the call.
    if (!(await provider.isAvailable(context))) {
      return {
        success: false,
        message: `Tool "${item.toolId}" is not available to the approver`,
        error: `Tool "${item.toolId}" is not available in the approver's context.`,
      };
    }

    this.logger.log(
      `Replaying approved static tool ${item.toolId} for proposal item ${item.id}`,
    );

    return provider.executeStaticTool(item.toolId, item.payload, context);
  }

  private emptyResult(proposalId: string, aborted: boolean): ApprovalResult {
    return {
      proposalId,
      appliedItemIds: [],
      conflictedItemIds: [],
      outOfScopeItemIds: [],
      failedItemIds: [],
      failures: [],
      aborted,
    };
  }
}
