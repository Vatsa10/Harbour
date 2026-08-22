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

import {
  type EvidencePayload,
  type EvidenceSourceType,
  type EvidenceStrength,
} from 'src/engine/metadata-modules/ai/ai-research/types/evidence.type';
import type { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

// Immutable observation. No @UpdateDateColumn — nothing in this codebase
// ever updates an existing row, only inserts new ones, so "why did the agent
// propose this, dated Y, from source Z" is always answerable from data that
// was never edited after the fact.
@Entity({ name: 'evidence', schema: 'core' })
@Index('IDX_EVIDENCE_RECORD', ['workspaceId', 'objectNameSingular', 'recordId'])
export class EvidenceEntity {
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

  // The AgentRun that produced this observation, when one exists. Nullable
  // because Phase 3's ingestion and import jobs are deterministic background
  // workers with no AgentRun — for those rows `sourceLocator` + `extractor`
  // carry the full traceability the Evidence contract requires. An agent-
  // produced observation must always set this.
  @Column({ type: 'uuid', nullable: true })
  @Index()
  runId: string | null;

  @Column({ type: 'varchar' })
  sourceType: EvidenceSourceType;

  // URL, record reference, or human-readable description of where this was seen.
  @Column({ type: 'text' })
  sourceLocator: string;

  @Column({ type: 'timestamptz' })
  observedAt: Date;

  // Tool/agent identifier that produced this row, e.g. "agent-run:<agentId>".
  @Column({ type: 'varchar' })
  extractor: string;

  @Column({ type: 'jsonb' })
  payload: EvidencePayload;

  // sha256 of payload — lets a duplicate observation be recognized without
  // re-parsing content.
  @Column({ type: 'varchar', length: 64 })
  payloadHash: string;

  // Deterministic, assigned server-side from sourceType. Never agent-reported.
  @Column({ type: 'varchar' })
  strength: EvidenceStrength;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
