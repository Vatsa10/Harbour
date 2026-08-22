import { type ActorMetadata } from 'searm-shared/types';

import { BaseWorkspaceEntity } from 'src/engine/searm-orm/base.workspace-entity';
import { type EntityRelation } from 'src/engine/workspace-manager/workspace-migration/types/entity-relation.interface';
import { type AttachmentWorkspaceEntity } from 'src/modules/attachment/standard-objects/attachment.workspace-entity';
import { type TimelineActivityWorkspaceEntity } from 'src/modules/timeline/standard-objects/timeline-activity.workspace-entity';

export class DashboardWorkspaceEntity extends BaseWorkspaceEntity {
  title: string | null;
  pageLayoutId: string | null;
  position: number;
  createdBy: ActorMetadata;
  updatedBy: ActorMetadata;
  timelineActivities: EntityRelation<TimelineActivityWorkspaceEntity[]>;
  attachments: EntityRelation<AttachmentWorkspaceEntity[]>;
  searchVector: string;
}
