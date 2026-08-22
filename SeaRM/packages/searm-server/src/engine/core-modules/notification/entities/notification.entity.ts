import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
} from 'typeorm';

import type { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

// The in-app notification primitive. One row is one thing a human should
// notice, with a link to the place it can be acted on. Deliberately not a
// notification centre: no channels, no preferences, no digests, no grouping —
// read/unread is the entire state machine.
@Entity({ name: 'notification', schema: 'core' })
@Index('IDX_NOTIFICATION_WORKSPACE_UNREAD', ['workspaceId', 'readAt'])
export class NotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  @Index()
  workspaceId: string;

  @ManyToOne('WorkspaceEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace: Relation<WorkspaceEntity>;

  // Null means "anyone in the workspace who can see it". Addressing a specific
  // reviewer is possible but not required — a proposal has no assignee yet, so
  // the pending queue is a workspace-level fact.
  @Column({ type: 'uuid', nullable: true })
  @Index()
  userWorkspaceId: string | null;

  @Column({ type: 'varchar', nullable: false })
  title: string;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  // Relative in-app path, e.g. "/settings/ai/approvals". Never an absolute URL:
  // a notification must not become a way to plant an outbound link in the UI.
  @Column({ type: 'varchar', nullable: true })
  linkPath: string | null;

  // Idempotency, per the execution contract: a retried job that raises the
  // same notification twice must produce one row. Unique per workspace.
  @Column({ type: 'varchar', nullable: true })
  dedupeKey: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
