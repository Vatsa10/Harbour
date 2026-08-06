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

import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import {
  ImportRowMatchAction,
  ImportRowStatus,
} from 'src/modules/guided-import/types/import-batch-status.type';

@Entity({ name: 'importRow', schema: 'core' })
@Index(['importBatchId', 'status'])
export class ImportRowEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  @Index()
  importBatchId: string;

  @ManyToOne(() => ImportBatchEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'importBatchId' })
  importBatch: Relation<ImportBatchEntity>;

  @Column({ type: 'int' })
  rowNumber: number;

  // The uploaded row, keyed by original CSV header, before mapping.
  @Column({ type: 'jsonb' })
  rawData: Record<string, unknown>;

  // rawData translated through mappingConfig into object field names. Set by
  // Task 7's mapping step.
  @Column({ type: 'jsonb', nullable: true })
  mappedData: Record<string, unknown> | null;

  @Column({ type: 'varchar', nullable: true })
  matchAction: ImportRowMatchAction | null;

  @Column({ type: 'uuid', nullable: true })
  matchedRecordId: string | null;

  // Per-field validation errors, e.g. { "email": "not a valid email" }. Empty
  // object means the row passed validation. Null means not yet validated.
  @Column({ type: 'jsonb', nullable: true })
  validationErrors: Record<string, string> | null;

  @Column({ type: 'varchar', default: ImportRowStatus.PENDING })
  status: ImportRowStatus;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
