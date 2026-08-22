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

import type { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { ImportBatchStatus } from 'src/modules/guided-import/types/import-batch-status.type';

@Entity({ name: 'importBatch', schema: 'core' })
export class ImportBatchEntity {
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

  @Column({ type: 'varchar' })
  fileName: string;

  @Column({ type: 'varchar', default: ImportBatchStatus.PENDING })
  @Index()
  status: ImportBatchStatus;

  // Column key (CSV header) -> object field name. Set once mapping is
  // confirmed (Task 7), read at execution time (Task 9).
  @Column({ type: 'jsonb', nullable: true })
  mappingConfig: Record<string, string> | null;

  @Column({ type: 'int', default: 0 })
  totalRows: number;

  @Column({ type: 'int', default: 0 })
  processedRows: number;

  @Column({ type: 'int', default: 0 })
  createdRowCount: number;

  @Column({ type: 'int', default: 0 })
  updatedRowCount: number;

  @Column({ type: 'int', default: 0 })
  proposedRowCount: number;

  @Column({ type: 'int', default: 0 })
  skippedRowCount: number;

  @Column({ type: 'int', default: 0 })
  failedRowCount: number;

  @Column({ type: 'uuid', nullable: true })
  createdByUserWorkspaceId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
