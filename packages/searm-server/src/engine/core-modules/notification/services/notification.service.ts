import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'searm-shared/utils';
import { IsNull, Repository } from 'typeorm';

import { NotificationEntity } from 'src/engine/core-modules/notification/entities/notification.entity';
import { isPostgresUniqueViolation } from 'src/utils/is-postgres-unique-violation.util';

export type RaiseNotificationInput = {
  workspaceId: string;
  title: string;
  body?: string | null;
  // Relative in-app path only. An absolute URL is rejected rather than stored.
  linkPath?: string | null;
  // Null/absent addresses the whole workspace.
  userWorkspaceId?: string | null;
  // Two raises with the same key in one workspace produce one row.
  dedupeKey?: string | null;
};

const MAX_UNREAD_RETURNED = 50;

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    // Reads filter on (workspaceId, readAt) and (workspaceId, dedupeKey) as
    // composite conditions, which the scoped wrapper's "workspaceId first,
    // merge rest" shape does not express — same reason the proposal services
    // opt out.
    // eslint-disable-next-line searm/prefer-workspace-scoped-repository
    @InjectRepository(NotificationEntity)
    private readonly notificationRepository: Repository<NotificationEntity>,
  ) {}

  // Returns the row, or null when a same-key notification already exists.
  // Never throws on a duplicate: a caller raising a notification is reporting
  // something that already happened, so failing the caller would be worse than
  // dropping the second copy.
  async raise(
    input: RaiseNotificationInput,
  ): Promise<NotificationEntity | null> {
    const linkPath = normalizeLinkPath(input.linkPath);

    if (isDefined(input.dedupeKey)) {
      const existing = await this.notificationRepository.findOne({
        where: { workspaceId: input.workspaceId, dedupeKey: input.dedupeKey },
      });

      if (isDefined(existing)) {
        return null;
      }
    }

    try {
      return await this.notificationRepository.save({
        workspaceId: input.workspaceId,
        userWorkspaceId: input.userWorkspaceId ?? null,
        title: input.title,
        body: input.body ?? null,
        linkPath,
        dedupeKey: input.dedupeKey ?? null,
        readAt: null,
      });
    } catch (error) {
      // find-then-save is not atomic; the unique index settles the race and a
      // violation means the other caller's row is the one that exists.
      if (isPostgresUniqueViolation(error) && isDefined(input.dedupeKey)) {
        return null;
      }

      throw error;
    }
  }

  // Workspace-wide rows plus rows addressed to this member. Newest first.
  async findUnread(params: {
    workspaceId: string;
    userWorkspaceId: string;
  }): Promise<NotificationEntity[]> {
    return this.notificationRepository.find({
      where: [
        {
          workspaceId: params.workspaceId,
          readAt: IsNull(),
          userWorkspaceId: IsNull(),
        },
        {
          workspaceId: params.workspaceId,
          readAt: IsNull(),
          userWorkspaceId: params.userWorkspaceId,
        },
      ],
      order: { createdAt: 'DESC' },
      take: MAX_UNREAD_RETURNED,
    });
  }

  // Returns null when the id belongs to another workspace or another member —
  // the same answer as "does not exist", so the mutation cannot be used to
  // probe for notification ids across tenants.
  async markRead(params: {
    id: string;
    workspaceId: string;
    userWorkspaceId: string;
  }): Promise<NotificationEntity | null> {
    const notification = await this.notificationRepository.findOne({
      where: { id: params.id, workspaceId: params.workspaceId },
    });

    if (!isDefined(notification)) {
      return null;
    }

    if (
      isDefined(notification.userWorkspaceId) &&
      notification.userWorkspaceId !== params.userWorkspaceId
    ) {
      return null;
    }

    if (isDefined(notification.readAt)) {
      return notification;
    }

    notification.readAt = new Date();

    return this.notificationRepository.save(notification);
  }
}

// A notification renders as a clickable link in the UI. Anything that is not a
// same-origin relative path is dropped rather than stored, so no caller can
// turn the bell into an outbound-link surface.
const normalizeLinkPath = (linkPath?: string | null): string | null => {
  if (!isDefined(linkPath) || linkPath === '') {
    return null;
  }

  if (!linkPath.startsWith('/') || linkPath.startsWith('//')) {
    return null;
  }

  return linkPath;
};
