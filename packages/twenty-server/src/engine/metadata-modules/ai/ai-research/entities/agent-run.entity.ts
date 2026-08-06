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

import { AgentTaskEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/agent-task.entity';
import { AgentRunStatus } from 'src/engine/metadata-modules/ai/ai-research/types/agent-run-status.type';
import type { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

@Entity({ name: 'agentRun', schema: 'core' })
export class AgentRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  @Index()
  workspaceId: string;

  @ManyToOne('WorkspaceEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace: Relation<WorkspaceEntity>;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  taskId: string | null;

  @ManyToOne(() => AgentTaskEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'taskId' })
  task: Relation<AgentTaskEntity> | null;

  @Column({ type: 'uuid' })
  agentId: string;

  // Charter trust-layer table names a "workflow link" on AgentRun. A plain
  // uuid, not an FK: workflowRun lives in the per-workspace schema, and a
  // run scheduled by cron or the GraphQL mutation has no workflow at all.
  // Set by any caller that knows its workflow run id; null otherwise.
  @Column({ type: 'uuid', nullable: true })
  @Index()
  workflowRunId: string | null;

  @Column({ type: 'varchar', default: AgentRunStatus.RUNNING })
  status: AgentRunStatus;

  @Column({ type: 'varchar', nullable: true })
  modelId: string | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  elapsedMs: number | null;

  @Column({ type: 'int', default: 0 })
  inputTokens: number;

  @Column({ type: 'int', default: 0 })
  outputTokens: number;

  @Column({ type: 'bigint', default: 0 })
  creditsUsedMicro: number;

  // No `transcript` column. Twenty already persists a full agent transcript
  // through AgentMessageEntity, nothing in Phases 2-5 reads AgentRun's copy,
  // and a jsonb mirror of the AI SDK's StepResult shape is a coupling to a
  // third-party type for no consumer. resultSummary is what run history needs.
  @Column({ type: 'text', nullable: true })
  resultSummary: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
