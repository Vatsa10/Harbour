import { NotFoundException, UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query } from '@nestjs/graphql';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { NotificationDTO } from 'src/engine/core-modules/notification/dtos/notification.dto';
import { type NotificationEntity } from 'src/engine/core-modules/notification/entities/notification.entity';
import { NotificationService } from 'src/engine/core-modules/notification/services/notification.service';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { AuthUserWorkspaceId } from 'src/engine/decorators/auth/auth-user-workspace-id.decorator';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';

// No settings permission flag. A notification carries no data the member could
// not already see, and gating the bell behind an admin flag would mean the
// people who need to notice a waiting proposal are exactly the ones who cannot.
@UseGuards(WorkspaceAuthGuard)
@MetadataResolver()
export class NotificationResolver {
  constructor(private readonly notificationService: NotificationService) {}

  @Query(() => [NotificationDTO])
  async unreadNotifications(
    @AuthWorkspace() workspace: FlatWorkspace,
    @AuthUserWorkspaceId() userWorkspaceId: string,
  ): Promise<NotificationDTO[]> {
    const notifications = await this.notificationService.findUnread({
      workspaceId: workspace.id,
      userWorkspaceId,
    });

    return notifications.map(toDTO);
  }

  @Mutation(() => NotificationDTO)
  async markNotificationRead(
    @Args('id', { type: () => ID }) id: string,
    @AuthWorkspace() workspace: FlatWorkspace,
    @AuthUserWorkspaceId() userWorkspaceId: string,
  ): Promise<NotificationDTO> {
    const notification = await this.notificationService.markRead({
      id,
      workspaceId: workspace.id,
      userWorkspaceId,
    });

    if (notification === null) {
      throw new NotFoundException('Notification not found');
    }

    return toDTO(notification);
  }
}

const toDTO = (notification: NotificationEntity): NotificationDTO => ({
  id: notification.id,
  title: notification.title,
  body: notification.body,
  linkPath: notification.linkPath,
  readAt: notification.readAt,
  createdAt: notification.createdAt,
});
