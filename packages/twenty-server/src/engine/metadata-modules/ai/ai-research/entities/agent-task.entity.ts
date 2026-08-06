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

import { type ActorMetadata } from 'twenty-shared/types';

import { AgentTaskStatus } from 'src/engine/metadata-modules/ai/ai-research/types/agent-task-status.type';
import type { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

@Entity({ name: 'agentTask', schema: 'core' })
export class AgentTaskEntity {
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

  // Which Agent runs this task. AgentEntity is @Entity('agent') on the core
  // schema (verified: ai-agent/entities/agent.entity.ts:18), so a FK would be
  // possible — it is deliberately a plain uuid so deleting an agent orphans
  // its task history rather than cascading it away. Task 5b's seeded
  // per-workspace research agent is what fills this for tool- and
  // cron-scheduled tasks.
  @Column({ type: 'uuid' })
  agentId: string;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'int', default: 0 })
  priority: number;

  // Informational spend estimate for cost reporting. The platform's
  // existing per-workspace credit ceiling (AiBillingService,
  // hasAvailableCreditsOrThrow) is what actually stops a run — this column
  // does not add a second enforcement mechanism. See Risks.
  @Column({ type: 'int', default: 8 })
  budget: number;

  @Column({ type: 'varchar', default: AgentTaskStatus.PENDING })
  @Index()
  status: AgentTaskStatus;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  dueAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  leasedUntil: Date | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'int', default: 3 })
  maxAttempts: number;

  // Dedup key: a second createTask() call with the same (workspaceId,
  // idempotencyKey) while a task is still open reuses the existing row
  // instead of scheduling duplicate work.
  @Column({ type: 'varchar', nullable: true })
  idempotencyKey: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'text', nullable: true })
  cancelReason: string | null;

  @Column({ type: 'uuid', nullable: true })
  lastRunId: string | null;

  // Human-readable result, filled in on both success and exhaustion —
  // "why did this task end up where it did" is always answerable without
  // opening a log file.
  @Column({ type: 'text', nullable: true })
  outcome: string | null;

  @Column({ type: 'jsonb', nullable: true })
  createdByActor: ActorMetadata | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
