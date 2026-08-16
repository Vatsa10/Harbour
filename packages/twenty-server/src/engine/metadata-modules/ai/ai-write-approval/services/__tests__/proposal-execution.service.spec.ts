import { ModuleRef } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CreateManyRecordsService } from 'src/engine/core-modules/record-crud/services/create-many-records.service';
import { CreateRecordService } from 'src/engine/core-modules/record-crud/services/create-record.service';
import { DeleteManyRecordsService } from 'src/engine/core-modules/record-crud/services/delete-many-records.service';
import { DeleteRecordService } from 'src/engine/core-modules/record-crud/services/delete-record.service';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { UpdateManyRecordsService } from 'src/engine/core-modules/record-crud/services/update-many-records.service';
import { UpdateRecordService } from 'src/engine/core-modules/record-crud/services/update-record.service';
import { UpsertManyRecordsService } from 'src/engine/core-modules/record-crud/services/upsert-many-records.service';
import { CreateCalendarEventTool } from 'src/engine/core-modules/tool/tools/calendar-tool/create-calendar-event-tool';
import { SendEmailTool } from 'src/engine/core-modules/tool/tools/email-tool/send-email-tool';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import { FactService } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
import { ProposalExecutionService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-execution.service';
import { PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';
import { UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

const buildItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-1',
  proposalId: 'proposal-1',
  actionType: 'UPDATE_RECORD',
  objectNameSingular: 'person',
  recordId: 'record-1',
  toolId: null,
  toolCategory: null,
  payload: { jobTitle: 'New title' },
  baseline: { jobTitle: 'Old title' },
  status: 'PENDING',
  factIds: [],
  ...overrides,
});

describe('ProposalExecutionService', () => {
  let service: ProposalExecutionService;

  const proposalRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };
  const proposalItemRepository = {
    find: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };
  const findRecordsService = { execute: jest.fn() };
  const updateRecordService = { execute: jest.fn() };
  const updateManyRecordsService = { execute: jest.fn() };
  const createRecordService = { execute: jest.fn() };
  const createManyRecordsService = { execute: jest.fn() };
  const upsertManyRecordsService = { execute: jest.fn() };
  const deleteRecordService = { execute: jest.fn() };
  const deleteManyRecordsService = { execute: jest.fn() };
  const userRoleService = { getRoleIdForUserWorkspace: jest.fn() };
  const permissionsService = { hasToolPermission: jest.fn() };
  const workspaceCacheService = { getOrRecompute: jest.fn() };
  const sendEmailTool = { execute: jest.fn() };
  const createCalendarEventTool = { execute: jest.fn() };
  const userRepository = { findOne: jest.fn() };
  const userWorkspaceRepository = { findOne: jest.fn() };
  const staticToolProvider = {
    category: 'view',
    isAvailable: jest.fn(),
    executeStaticTool: jest.fn(),
  };
  const moduleRef = { get: jest.fn() };
  const factService = { markDismissed: jest.fn() };
  const workspaceRepository = { update: jest.fn() };
  const globalWorkspaceOrmManager = {
    getRepository: jest.fn(),
    executeInWorkspaceContext: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    proposalRepository.findOne.mockResolvedValue({
      id: 'proposal-1',
      workspaceId: 'workspace-1',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 86400000),
    });
    // Every conditional UPDATE claims its row unless a test says otherwise.
    proposalRepository.update.mockResolvedValue({ affected: 1 });
    proposalItemRepository.update.mockResolvedValue({ affected: 1 });
    proposalItemRepository.save.mockImplementation(async (entity) => entity);
    userRoleService.getRoleIdForUserWorkspace.mockResolvedValue('role-1');
    permissionsService.hasToolPermission.mockResolvedValue(true);
    userWorkspaceRepository.findOne.mockResolvedValue({
      id: 'user-workspace-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    userRepository.findOne.mockResolvedValue({
      id: 'user-1',
      firstName: 'Jane',
      lastName: 'Austen',
      email: 'jane@apple.dev',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    workspaceCacheService.getOrRecompute.mockResolvedValue({
      flatWorkspaceMemberMaps: {
        idByUserId: { 'user-1': 'workspace-member-1' },
        byId: { 'workspace-member-1': { id: 'workspace-member-1' } },
      },
    });
    updateRecordService.execute.mockResolvedValue({
      success: true,
      message: 'updated',
    });
    createManyRecordsService.execute.mockResolvedValue({
      success: true,
      message: 'created',
    });
    upsertManyRecordsService.execute.mockResolvedValue({
      success: true,
      message: 'upserted',
    });
    updateManyRecordsService.execute.mockResolvedValue({
      success: true,
      message: 'updated',
    });
    deleteManyRecordsService.execute.mockResolvedValue({
      success: true,
      message: 'deleted',
    });
    staticToolProvider.isAvailable.mockResolvedValue(true);
    staticToolProvider.executeStaticTool.mockResolvedValue({
      success: true,
      message: 'ran',
    });
    moduleRef.get.mockReturnValue([staticToolProvider]);
    workspaceRepository.update.mockResolvedValue({ affected: 1 });
    globalWorkspaceOrmManager.getRepository.mockResolvedValue(
      workspaceRepository,
    );
    globalWorkspaceOrmManager.executeInWorkspaceContext.mockImplementation(
      async (fn: () => unknown) => fn(),
    );
    findRecordsService.execute.mockResolvedValue({
      success: true,
      message: 'ok',
      result: { records: [{ id: 'record-1', jobTitle: 'Old title' }] },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProposalExecutionService,
        { provide: FindRecordsService, useValue: findRecordsService },
        { provide: UpdateRecordService, useValue: updateRecordService },
        {
          provide: UpdateManyRecordsService,
          useValue: updateManyRecordsService,
        },
        { provide: CreateRecordService, useValue: createRecordService },
        {
          provide: CreateManyRecordsService,
          useValue: createManyRecordsService,
        },
        {
          provide: UpsertManyRecordsService,
          useValue: upsertManyRecordsService,
        },
        { provide: DeleteRecordService, useValue: deleteRecordService },
        {
          provide: DeleteManyRecordsService,
          useValue: deleteManyRecordsService,
        },
        { provide: UserRoleService, useValue: userRoleService },
        { provide: PermissionsService, useValue: permissionsService },
        { provide: WorkspaceCacheService, useValue: workspaceCacheService },
        { provide: SendEmailTool, useValue: sendEmailTool },
        { provide: CreateCalendarEventTool, useValue: createCalendarEventTool },
        { provide: ModuleRef, useValue: moduleRef },
        {
          provide: getRepositoryToken(UserEntity),
          useValue: userRepository,
        },
        {
          provide: getRepositoryToken(UserWorkspaceEntity),
          useValue: userWorkspaceRepository,
        },
        {
          provide: getRepositoryToken(ProposalEntity),
          useValue: proposalRepository,
        },
        {
          provide: getRepositoryToken(ProposalItemEntity),
          useValue: proposalItemRepository,
        },
        { provide: FactService, useValue: factService },
        {
          provide: GlobalWorkspaceOrmManager,
          useValue: globalWorkspaceOrmManager,
        },
      ],
    }).compile();

    service = module.get<ProposalExecutionService>(ProposalExecutionService);
  });

  const approve = (selectedItemIds: string[]) =>
    service.approve({
      proposalId: 'proposal-1',
      selectedItemIds,
      workspaceId: 'workspace-1',
      approverUserWorkspaceId: 'user-workspace-1',
    });

  const proposalStatusWrites = () =>
    proposalRepository.update.mock.calls.map(([, patch]) => patch.status);

  const itemStatusWrite = (itemId: string) =>
    proposalItemRepository.update.mock.calls.find(([where]) => {
      if (where.id === itemId) {
        return true;
      }

      const inValues = (where.id as { _value?: unknown })?._value;

      return Array.isArray(inValues) && inValues.includes(itemId);
    })?.[1];

  it('should apply a selected item whose baseline still matches', async () => {
    proposalItemRepository.find.mockResolvedValue([buildItem()]);

    const result = await approve(['item-1']);

    expect(updateRecordService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        objectName: 'person',
        objectRecordId: 'record-1',
        objectRecord: { jobTitle: 'New title' },
      }),
    );
    expect(result.appliedItemIds).toEqual(['item-1']);
    expect(result.aborted).toBe(false);
  });

  // I4: the record must name the approver, not SYSTEM.
  it('should apply as the approver, with the approver as the audit actor', async () => {
    proposalItemRepository.find.mockResolvedValue([buildItem()]);

    await approve(['item-1']);

    expect(updateRecordService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        rolePermissionConfig: { unionOf: ['role-1'] },
        updatedBy: expect.objectContaining({
          workspaceMemberId: 'workspace-member-1',
          name: 'Jane Austen',
        }),
        authContext: expect.objectContaining({
          userWorkspaceId: 'user-workspace-1',
        }),
      }),
    );
  });

  it('should pass the approver as createdBy on a create', async () => {
    createRecordService.execute.mockResolvedValue({
      success: true,
      message: 'created',
      result: { record: { id: 'new-record-1' } },
    });
    proposalItemRepository.find.mockResolvedValue([
      buildItem({
        actionType: 'CREATE_RECORD',
        recordId: null,
        baseline: {},
        payload: { name: 'A' },
      }),
    ]);

    await approve(['item-1']);

    expect(createRecordService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        createdBy: expect.objectContaining({ name: 'Jane Austen' }),
      }),
    );
    expect(itemStatusWrite('item-1')).toMatchObject({
      status: 'APPLIED',
      resultRecordId: 'new-record-1',
    });
  });

  // C3: each bulk envelope must replay through its own service, unmerged.
  describe('bulk items replay their real envelope', () => {
    it('should create every record of a CREATE_RECORDS item', async () => {
      const records = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];

      proposalItemRepository.find.mockResolvedValue([
        buildItem({
          actionType: 'CREATE_RECORDS',
          recordId: null,
          baseline: {},
          payload: { records },
        }),
      ]);

      const result = await approve(['item-1']);

      expect(createManyRecordsService.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          objectName: 'person',
          objectRecords: records,
        }),
      );
      expect(createRecordService.execute).not.toHaveBeenCalled();
      expect(result.appliedItemIds).toEqual(['item-1']);
    });

    it('should upsert rather than create an UPSERT_RECORDS item', async () => {
      const records = [{ name: 'A' }, { name: 'B' }];

      proposalItemRepository.find.mockResolvedValue([
        buildItem({
          actionType: 'UPSERT_RECORDS',
          recordId: null,
          baseline: {},
          payload: { records },
        }),
      ]);

      await approve(['item-1']);

      expect(upsertManyRecordsService.execute).toHaveBeenCalledWith(
        expect.objectContaining({ objectRecords: records }),
      );
      expect(createManyRecordsService.execute).not.toHaveBeenCalled();
    });

    it('should replay an UPDATE_RECORDS item with its filter', async () => {
      const filter = { city: { eq: 'Berlin' } };

      proposalItemRepository.find.mockResolvedValue([
        buildItem({
          actionType: 'UPDATE_RECORDS',
          recordId: null,
          baseline: {},
          payload: { filter, data: { jobTitle: 'Lead' } },
        }),
      ]);

      const result = await approve(['item-1']);

      expect(updateManyRecordsService.execute).toHaveBeenCalledWith(
        expect.objectContaining({ filter, data: { jobTitle: 'Lead' } }),
      );
      expect(result.failedItemIds).toEqual([]);
      expect(result.appliedItemIds).toEqual(['item-1']);
    });

    it('should replay a DELETE_RECORDS item with its filter', async () => {
      const filter = { city: { eq: 'Berlin' } };

      proposalItemRepository.find.mockResolvedValue([
        buildItem({
          actionType: 'DELETE_RECORDS',
          recordId: null,
          baseline: {},
          payload: { filter },
        }),
      ]);

      const result = await approve(['item-1']);

      expect(deleteManyRecordsService.execute).toHaveBeenCalledWith(
        expect.objectContaining({ filter }),
      );
      expect(result.appliedItemIds).toEqual(['item-1']);
    });
  });

  // I2: only the items that actually went stale may be flagged.
  it('should flag only the conflicted item and leave the rest reviewable', async () => {
    proposalItemRepository.find.mockResolvedValue([
      buildItem(),
      buildItem({ id: 'item-2', recordId: 'record-2' }),
    ]);
    findRecordsService.execute.mockImplementation(async ({ filter }) =>
      filter.id.eq === 'record-1'
        ? {
            success: true,
            message: 'ok',
            result: { records: [{ jobTitle: 'Human edited this' }] },
          }
        : {
            success: true,
            message: 'ok',
            result: { records: [{ jobTitle: 'Old title' }] },
          },
    );

    const result = await approve(['item-1', 'item-2']);

    expect(updateRecordService.execute).not.toHaveBeenCalled();
    expect(result.aborted).toBe(true);
    expect(result.conflictedItemIds).toEqual(['item-1']);
    // The proposal goes back to PENDING so the clean item stays reviewable.
    expect(proposalStatusWrites()).toEqual(['APPLYING', 'PENDING']);
  });

  it('should reject items the reviewer did not select', async () => {
    proposalItemRepository.find.mockResolvedValue([
      buildItem(),
      buildItem({ id: 'item-2' }),
    ]);

    await approve(['item-1']);

    expect(itemStatusWrite('item-2')).toMatchObject({ status: 'REJECTED' });
  });

  it('should dismiss the facts behind an item the reviewer deselected', async () => {
    proposalItemRepository.find.mockResolvedValue([
      buildItem({ factIds: ['fact-1'] }),
      buildItem({ id: 'item-2', factIds: ['fact-2'] }),
    ]);

    await approve(['item-1']);

    // Only the deselected item's facts. Approving item-1 is a "yes" to its
    // facts, not a "no".
    expect(factService.markDismissed).toHaveBeenCalledWith('workspace-1', [
      'fact-2',
    ]);
  });

  it('should not dismiss anything when every item was selected', async () => {
    proposalItemRepository.find.mockResolvedValue([
      buildItem({ factIds: ['fact-1'] }),
    ]);

    await approve(['item-1']);

    expect(factService.markDismissed).toHaveBeenCalledWith('workspace-1', []);
  });

  it('should dismiss the facts behind every still-open item in a whole-proposal reject', async () => {
    proposalItemRepository.find.mockResolvedValue([
      buildItem({ factIds: ['fact-1'] }),
      // reject() clears CONFLICTED items too — their facts are dismissed with
      // the rest, which an earlier draft of this task silently dropped.
      buildItem({ id: 'item-2', status: 'CONFLICTED', factIds: ['fact-2'] }),
    ]);

    await service.reject({
      proposalId: 'proposal-1',
      workspaceId: 'workspace-1',
      approverUserWorkspaceId: 'user-workspace-1',
    });

    expect(factService.markDismissed).toHaveBeenCalledWith('workspace-1', [
      'fact-1',
      'fact-2',
    ]);
  });

  // I5: a batch that wrote nothing successfully is not APPLIED.
  describe('final status reflects the real outcome', () => {
    it('should mark a fully failed batch FAILED', async () => {
      proposalItemRepository.find.mockResolvedValue([buildItem()]);
      updateRecordService.execute.mockResolvedValue({
        success: false,
        message: 'permission denied',
        error: 'permission denied',
      });

      const result = await approve(['item-1']);

      expect(result.failedItemIds).toEqual(['item-1']);
      expect(proposalStatusWrites()).toEqual(['APPLYING', 'FAILED']);
    });

    it('should mark a mixed batch PARTIALLY_APPLIED', async () => {
      proposalItemRepository.find.mockResolvedValue([
        buildItem(),
        buildItem({ id: 'item-2' }),
      ]);
      updateRecordService.execute
        .mockResolvedValueOnce({ success: true, message: 'updated' })
        .mockResolvedValueOnce({
          success: false,
          message: 'nope',
          error: 'nope',
        });

      await approve(['item-1', 'item-2']);

      expect(proposalStatusWrites()).toEqual(['APPLYING', 'PARTIALLY_APPLIED']);
    });

    it('should mark a batch approved with an empty selection REJECTED', async () => {
      proposalItemRepository.find.mockResolvedValue([buildItem()]);

      await approve([]);

      expect(updateRecordService.execute).not.toHaveBeenCalled();
      expect(proposalStatusWrites()).toEqual(['APPLYING', 'REJECTED']);
    });

    it('should mark a fully applied batch APPLIED', async () => {
      proposalItemRepository.find.mockResolvedValue([buildItem()]);

      await approve(['item-1']);

      expect(proposalStatusWrites()).toEqual(['APPLYING', 'APPLIED']);
    });
  });

  // I5: two concurrent approvals must not both apply.
  it('should bail without writing when it cannot claim the proposal', async () => {
    proposalItemRepository.find.mockResolvedValue([buildItem()]);
    proposalRepository.update.mockResolvedValue({ affected: 0 });

    const result = await approve(['item-1']);

    expect(updateRecordService.execute).not.toHaveBeenCalled();
    expect(sendEmailTool.execute).not.toHaveBeenCalled();
    expect(result.aborted).toBe(true);
    expect(result.appliedItemIds).toEqual([]);
  });

  it('should claim the proposal only while it is still PENDING', async () => {
    proposalItemRepository.find.mockResolvedValue([buildItem()]);

    await approve(['item-1']);

    expect(proposalRepository.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'proposal-1', status: 'PENDING' }),
      { status: 'APPLYING' },
    );
  });

  it('should apply record writes before outbound sends', async () => {
    const applyOrder: string[] = [];

    updateRecordService.execute.mockImplementation(async () => {
      applyOrder.push('record');

      return { success: true, message: 'updated' };
    });
    sendEmailTool.execute.mockImplementation(async () => {
      applyOrder.push('email');

      return { success: true, message: 'sent' };
    });

    proposalItemRepository.find.mockResolvedValue([
      buildItem({
        id: 'item-email',
        actionType: 'SEND_EMAIL',
        objectNameSingular: null,
        recordId: null,
        baseline: {},
        payload: { to: 'a@example.com', subject: 'Hi', body: 'Hello' },
      }),
      buildItem({ id: 'item-record' }),
    ]);

    await approve(['item-email', 'item-record']);

    expect(applyOrder).toEqual(['record', 'email']);
  });

  // I7: the dispatch path re-checks tool permissions; approval must too.
  it('should refuse an outbound send the approver lacks permission for', async () => {
    permissionsService.hasToolPermission.mockResolvedValue(false);
    proposalItemRepository.find.mockResolvedValue([
      buildItem({
        actionType: 'SEND_EMAIL',
        objectNameSingular: null,
        recordId: null,
        baseline: {},
        payload: { to: 'a@example.com' },
      }),
    ]);

    const result = await approve(['item-1']);

    expect(sendEmailTool.execute).not.toHaveBeenCalled();
    expect(result.failedItemIds).toEqual(['item-1']);
  });

  describe('static tool items', () => {
    const staticItem = (overrides: Record<string, unknown> = {}) =>
      buildItem({
        actionType: 'STATIC_TOOL',
        objectNameSingular: null,
        recordId: null,
        baseline: {},
        toolId: 'create_view',
        toolCategory: 'view',
        payload: { name: 'My view' },
        ...overrides,
      });

    it('should replay an approved static tool through its provider', async () => {
      proposalItemRepository.find.mockResolvedValue([staticItem()]);

      const result = await approve(['item-1']);

      expect(staticToolProvider.executeStaticTool).toHaveBeenCalledWith(
        'create_view',
        { name: 'My view' },
        expect.objectContaining({ userWorkspaceId: 'user-workspace-1' }),
      );
      expect(result.appliedItemIds).toEqual(['item-1']);
    });

    it('should refuse when the tool is unavailable to the approver', async () => {
      staticToolProvider.isAvailable.mockResolvedValue(false);
      proposalItemRepository.find.mockResolvedValue([staticItem()]);

      const result = await approve(['item-1']);

      expect(staticToolProvider.executeStaticTool).not.toHaveBeenCalled();
      expect(result.failedItemIds).toEqual(['item-1']);
    });
  });

  it('should refuse to approve an expired proposal', async () => {
    proposalRepository.findOne.mockResolvedValue({
      id: 'proposal-1',
      workspaceId: 'workspace-1',
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 86400000),
    });
    proposalItemRepository.find.mockResolvedValue([buildItem()]);

    const result = await approve(['item-1']);

    expect(result.aborted).toBe(true);
    expect(updateRecordService.execute).not.toHaveBeenCalled();
    expect(proposalStatusWrites()).toEqual(['EXPIRED']);
  });

  describe('reject', () => {
    it('should reject pending and conflicted items', async () => {
      proposalItemRepository.find.mockResolvedValue([]);

      const result = await service.reject({
        proposalId: 'proposal-1',
        workspaceId: 'workspace-1',
        approverUserWorkspaceId: 'user-workspace-1',
      });

      expect(result.aborted).toBe(false);
      expect(proposalItemRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ proposalId: 'proposal-1' }),
        { status: 'REJECTED' },
      );
    });

    it('should bail when the proposal is no longer pending', async () => {
      proposalRepository.update.mockResolvedValue({ affected: 0 });

      const result = await service.reject({
        proposalId: 'proposal-1',
        workspaceId: 'workspace-1',
        approverUserWorkspaceId: 'user-workspace-1',
      });

      expect(result.aborted).toBe(true);
      expect(proposalItemRepository.update).not.toHaveBeenCalled();
      expect(factService.markDismissed).not.toHaveBeenCalled();
    });
  });

  describe('objects blocked from automation', () => {
    const participantItem = (overrides: Record<string, unknown> = {}) =>
      buildItem({
        objectNameSingular: 'messageParticipant',
        recordId: 'participant-1',
        payload: { personId: 'person-1' },
        baseline: { personId: null },
        ...overrides,
      });

    beforeEach(() => {
      findRecordsService.execute.mockResolvedValue({
        success: true,
        message: 'ok',
        result: { records: [{ id: 'participant-1', personId: null }] },
      });
    });

    it('should apply a messageParticipant link that record-crud refuses on automation grounds', async () => {
      proposalItemRepository.find.mockResolvedValue([participantItem()]);

      const result = await approve(['item-1']);

      // record-crud would return success:false for this object, so the item
      // must not be routed there.
      expect(updateRecordService.execute).not.toHaveBeenCalled();
      expect(globalWorkspaceOrmManager.getRepository).toHaveBeenCalledWith(
        'workspace-1',
        'messageParticipant',
        { unionOf: ['role-1'] },
      );
      expect(workspaceRepository.update).toHaveBeenCalledWith('participant-1', {
        personId: 'person-1',
      });
      expect(result.appliedItemIds).toEqual(['item-1']);
      expect(result.failedItemIds).toEqual([]);
      expect(result.failures).toEqual([]);
      expect(itemStatusWrite('item-1')?.status).toBe('APPLIED');
    });

    it('should fail the item with a reason when the row no longer exists', async () => {
      proposalItemRepository.find.mockResolvedValue([participantItem()]);
      workspaceRepository.update.mockResolvedValue({ affected: 0 });

      const result = await approve(['item-1']);

      expect(result.appliedItemIds).toEqual([]);
      expect(result.failedItemIds).toEqual(['item-1']);
      expect(result.failures).toEqual([
        {
          itemId: 'item-1',
          error: expect.stringContaining(
            'No messageParticipant row with id participant-1 was updated',
          ),
        },
      ]);
      expect(itemStatusWrite('item-1')?.error).toContain('participant-1');
    });

    it('should refuse an action shape other than a single-record update', async () => {
      proposalItemRepository.find.mockResolvedValue([
        participantItem({ actionType: 'DELETE_RECORD', baseline: {} }),
      ]);

      const result = await approve(['item-1']);

      expect(workspaceRepository.update).not.toHaveBeenCalled();
      expect(deleteRecordService.execute).not.toHaveBeenCalled();
      expect(result.failedItemIds).toEqual(['item-1']);
      expect(result.failures[0].error).toContain('blocked from automated writes');
    });
  });

  it('should surface the underlying error text for a failed item', async () => {
    proposalItemRepository.find.mockResolvedValue([buildItem()]);
    updateRecordService.execute.mockResolvedValue({
      success: false,
      message: 'Failed to update record in person',
      error: 'Field jobTitle is not writable by this role',
    });

    const result = await approve(['item-1']);

    expect(result.failures).toEqual([
      {
        itemId: 'item-1',
        error: 'Field jobTitle is not writable by this role',
      },
    ]);
  });

});
