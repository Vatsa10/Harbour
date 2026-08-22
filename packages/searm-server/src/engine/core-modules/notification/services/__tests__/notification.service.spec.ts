import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { NotificationEntity } from 'src/engine/core-modules/notification/entities/notification.entity';
import { NotificationService } from 'src/engine/core-modules/notification/services/notification.service';

describe('NotificationService', () => {
  let service: NotificationService;

  const repository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    repository.findOne.mockResolvedValue(null);
    repository.find.mockResolvedValue([]);
    repository.save.mockImplementation(async (row) => ({
      id: 'notification-1',
      ...row,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: getRepositoryToken(NotificationEntity),
          useValue: repository,
        },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
  });

  describe('raise', () => {
    it('should persist an unread notification scoped to the workspace', async () => {
      const notification = await service.raise({
        workspaceId: 'workspace-1',
        title: 'A proposal is waiting for review',
        linkPath: '/settings/ai/approvals',
      });

      expect(repository.save).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        userWorkspaceId: null,
        title: 'A proposal is waiting for review',
        body: null,
        linkPath: '/settings/ai/approvals',
        dedupeKey: null,
        readAt: null,
      });
      expect(notification?.readAt).toBeNull();
    });

    it('should write nothing on a second raise with the same dedupe key', async () => {
      repository.findOne.mockResolvedValue({ id: 'notification-1' });

      const notification = await service.raise({
        workspaceId: 'workspace-1',
        title: 'A proposal is waiting for review',
        dedupeKey: 'proposal:proposal-1',
      });

      expect(notification).toBeNull();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('should return null rather than throw when a concurrent raise wins the unique index', async () => {
      repository.save.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );

      await expect(
        service.raise({
          workspaceId: 'workspace-1',
          title: 'A proposal is waiting for review',
          dedupeKey: 'proposal:proposal-1',
        }),
      ).resolves.toBeNull();
    });

    it('should rethrow a save failure that is not a unique violation', async () => {
      repository.save.mockRejectedValueOnce(
        Object.assign(new Error('connection terminated'), { code: '08006' }),
      );

      await expect(
        service.raise({ workspaceId: 'workspace-1', title: 'Something' }),
      ).rejects.toThrow('connection terminated');
    });

    it.each([
      ['https://evil.example.com/steal', 'an absolute URL'],
      ['//evil.example.com', 'a protocol-relative URL'],
      ['javascript:alert(1)', 'a javascript: URL'],
    ])('should drop %s (%s) rather than store it as a link', async (link) => {
      await service.raise({
        workspaceId: 'workspace-1',
        title: 'Something',
        linkPath: link,
      });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ linkPath: null }),
      );
    });
  });

  describe('markRead', () => {
    it('should stamp readAt on a workspace-wide notification', async () => {
      repository.findOne.mockResolvedValue({
        id: 'notification-1',
        workspaceId: 'workspace-1',
        userWorkspaceId: null,
        readAt: null,
      });

      const result = await service.markRead({
        id: 'notification-1',
        workspaceId: 'workspace-1',
        userWorkspaceId: 'member-1',
      });

      expect(result?.readAt).toBeInstanceOf(Date);
    });

    it('should return null for a notification addressed to another member', async () => {
      repository.findOne.mockResolvedValue({
        id: 'notification-1',
        workspaceId: 'workspace-1',
        userWorkspaceId: 'member-2',
        readAt: null,
      });

      const result = await service.markRead({
        id: 'notification-1',
        workspaceId: 'workspace-1',
        userWorkspaceId: 'member-1',
      });

      expect(result).toBeNull();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('should not restamp an already-read notification', async () => {
      const readAt = new Date('2026-01-01T00:00:00.000Z');

      repository.findOne.mockResolvedValue({
        id: 'notification-1',
        workspaceId: 'workspace-1',
        userWorkspaceId: null,
        readAt,
      });

      const result = await service.markRead({
        id: 'notification-1',
        workspaceId: 'workspace-1',
        userWorkspaceId: 'member-1',
      });

      expect(result?.readAt).toBe(readAt);
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('findUnread', () => {
    it('should ask only for unread rows of this workspace, addressed to the workspace or this member', async () => {
      await service.findUnread({
        workspaceId: 'workspace-1',
        userWorkspaceId: 'member-1',
      });

      const { where, order } = repository.find.mock.calls[0][0];

      expect(where).toHaveLength(2);
      expect(where[0].workspaceId).toBe('workspace-1');
      expect(where[1].userWorkspaceId).toBe('member-1');
      expect(order).toEqual({ createdAt: 'DESC' });
    });
  });
});
