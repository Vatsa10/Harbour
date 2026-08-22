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

import { type EvidenceStrength } from 'src/engine/metadata-modules/ai/ai-research/types/evidence.type';
import { FactStatus } from 'src/engine/metadata-modules/ai/ai-research/types/fact-status.type';
import type { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

@Entity({ name: 'fact', schema: 'core' })
@Index('IDX_FACT_CURRENT_LOOKUP', [
  'workspaceId',
  'objectNameSingular',
  'recordId',
  'fieldName',
  'status',
])
export class FactEntity {
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
  @Index()
  recordId: string;

  @Column({ type: 'varchar' })
  fieldName: string;

  @Column({ type: 'jsonb' })
  value: unknown;

  @Column({ type: 'varchar', default: FactStatus.CURRENT })
  status: FactStatus;

  // True when a differing value was observed in the same research run as
  // this fact's own evidence — a genuine contradiction, not a change over
  // time. Set on both facts in the pair.
  @Column({ type: 'boolean', default: false })
  hasConflict: boolean;

  @Column({ type: 'varchar' })
  strength: EvidenceStrength;

  // Evidence rows that support this fact. Grows on corroboration (same
  // value observed again); a new Fact row is only created when the value
  // itself changes.
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  evidenceIds: string[];

  // The run whose evidence most recently touched this fact. Null when the
  // most recent evidence came from a Phase 3 ingestion/import worker.
  @Column({ type: 'uuid', nullable: true })
  runId: string | null;

  // Freshness (charter trust-layer table). Not createdAt and not updatedAt:
  // this is when the *world* was observed, copied from the observing
  // Evidence.observedAt, so a fact corroborated today by a source dated last
  // year does not read as fresh. Corroboration advances it; supersession
  // starts a new row with its own value.
  @Column({ type: 'timestamptz' })
  lastObservedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  supersededAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  supersededByFactId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
