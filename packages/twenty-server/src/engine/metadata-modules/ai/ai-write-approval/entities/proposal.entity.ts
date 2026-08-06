import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from 'typeorm';

import { type ActorMetadata } from 'twenty-shared/types';

import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalStatus } from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';
import type { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

@Entity({ name: 'proposal', schema: 'core' })
export class ProposalEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  @Index()
  workspaceId: string;

  @ManyToOne('WorkspaceEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace: Relation<WorkspaceEntity>;

  @Column({ type: 'varchar', default: ProposalStatus.PENDING })
  @Index()
  status: ProposalStatus;

  @Column({ type: 'jsonb', nullable: true })
  createdByActor: ActorMetadata | null;

  // Correlates every tool call from one agent turn into a single reviewable batch.
  @Column({ type: 'uuid', nullable: true })
  @Index()
  threadId: string | null;

  @Column({ type: 'timestamptz', nullable: false })
  expiresAt: Date;

  @Column({ type: 'uuid', nullable: true })
  reviewedByUserWorkspaceId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @OneToMany(() => ProposalItemEntity, (item) => item.proposal)
  items: Relation<ProposalItemEntity[]>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
