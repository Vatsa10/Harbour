import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from 'typeorm';

import { type BriefSections } from 'src/engine/metadata-modules/ai/ai-research/types/record-brief.type';
import type { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

// One brief per record, always replaced. Unlike Fact, there is no history and
// no SUPERSEDED state: a brief is the current best narrative, explicitly
// non-authoritative, never a system of record. The audit trail lives on the
// facts it was composed from (factIds), which do keep history.
@Entity({ name: 'recordBrief', schema: 'core' })
@Index(
  'IDX_RECORD_BRIEF_RECORD_UNIQUE',
  ['workspaceId', 'objectNameSingular', 'recordId'],
  { unique: true },
)
export class RecordBriefEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  @Index()
  workspaceId: string;

  @ManyToOne('WorkspaceEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace: Relation<WorkspaceEntity>;

  @Column({ type: 'varchar' })
  objectNameSingular: string;

  @Column({ type: 'uuid' })
  recordId: string;

  @Column({ type: 'text' })
  narrative: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  sections: BriefSections;

  // Every sentence in the narrative traces back to one of these facts. Stored
  // so the surface can cite them and so a reviewer can answer "on what basis"
  // without re-deriving the brief.
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  factIds: string[];

  // Oldest observation behind the brief: the panel's freshness is only as good
  // as its stalest sourced claim, not as good as the moment it was composed.
  @Column({ type: 'timestamptz' })
  oldestObservedAt: Date;

  @Column({ type: 'timestamptz' })
  refreshedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
