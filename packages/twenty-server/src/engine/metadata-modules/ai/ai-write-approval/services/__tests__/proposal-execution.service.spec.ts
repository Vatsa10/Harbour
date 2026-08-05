import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CreateRecordService } from 'src/engine/core-modules/record-crud/services/create-record.service';
import { DeleteRecordService } from 'src/engine/core-modules/record-crud/services/delete-record.service';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { UpdateRecordService } from 'src/engine/core-modules/record-crud/services/update-record.service';
import { CreateCalendarEventTool } from 'src/engine/core-modules/tool/tools/calendar-tool/create-calendar-event-tool';
import { SendEmailTool } from 'src/engine/core-modules/tool/tools/email-tool/send-email-tool';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import { ProposalExecutionService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-execution.service';
import { UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';

const buildItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-1',
  proposalId: 'proposal-1',
  actionType: 'UPDATE_RECORD',
  objectNameSingular: 'person',
  recordId: 'record-1',
  payload: { jobTitle: 'New title' },
  baseline: { jobTitle: 'Old title' },
  status: 'PENDING',
  ...overrides,
});

describe('ProposalExecutionService', () => {
  let service: ProposalExecutionService;

  const proposalRepository = { findOne: jest.fn(), save: jest.fn() };
  const proposalItemRepository = { find: jest.fn(), save: jest.fn() };
  const findRecordsService = { execute: jest.fn() };
  const updateRecordService = { execute: jest.fn() };
  const createRecordService = { execute: jest.fn() };
  const deleteRecordService = { execute: jest.fn() };
  const userRoleService = { getRoleIdForUserWorkspace: jest.fn() };
  const sendEmailTool = { execute: jest.fn() };
  const createCalendarEventTool = { execute: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    proposalRepository.findOne.mockResolvedValue({
      id: 'proposal-1',
      workspaceId: 'workspace-1',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 86400000),
    });
    proposalRepository.save.mockImplementation(async (entity) => entity);
    proposalItemRepository.save.mockImplementation(async (entity) => entity);
    userRoleService.getRoleIdForUserWorkspace.mockResolvedValue('role-1');
    updateRecordService.execute.mockResolvedValue({
      success: true,
      message: 'updated',
    });
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
        { provide: CreateRecordService, useValue: createRecordService },
        { provide: DeleteRecordService, useValue: deleteRecordService },
        { provide: UserRoleService, useValue: userRoleService },
        { provide: SendEmailTool, useValue: sendEmailTool },
        { provide: CreateCalendarEventTool, useValue: createCalendarEventTool },
        {
          provide: getRepositoryToken(ProposalEntity, 'core'),
          useValue: proposalRepository,
        },
        {
          provide: getRepositoryToken(ProposalItemEntity, 'core'),
          useValue: proposalItemRepository,
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

  it('should apply as the approver, not as the agent', async () => {
    proposalItemRepository.find.mockResolvedValue([buildItem()]);

    await approve(['item-1']);

    expect(updateRecordService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        rolePermissionConfig: { unionOf: ['role-1'] },
      }),
    );
  });

  it('should abort the whole batch when any baseline changed', async () => {
    proposalItemRepository.find.mockResolvedValue([
      buildItem(),
      buildItem({ id: 'item-2' }),
    ]);
    findRecordsService.execute.mockResolvedValue({
      success: true,
      message: 'ok',
      result: { records: [{ id: 'record-1', jobTitle: 'Human edited this' }] },
    });

    const result = await approve(['item-1', 'item-2']);

    expect(updateRecordService.execute).not.toHaveBeenCalled();
    expect(result.aborted).toBe(true);
    expect(result.conflictedItemIds).toEqual(['item-1', 'item-2']);
  });

  it('should reject items the reviewer did not select', async () => {
    proposalItemRepository.find.mockResolvedValue([
      buildItem(),
      buildItem({ id: 'item-2' }),
    ]);

    await approve(['item-1']);

    expect(proposalItemRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'item-2', status: 'REJECTED' }),
    );
  });

  it('should mark an item FAILED when its write fails', async () => {
    proposalItemRepository.find.mockResolvedValue([buildItem()]);
    updateRecordService.execute.mockResolvedValue({
      success: false,
      message: 'permission denied',
      error: 'permission denied',
    });

    const result = await approve(['item-1']);

    expect(result.failedItemIds).toEqual(['item-1']);
    expect(result.appliedItemIds).toEqual([]);
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
  });
});
