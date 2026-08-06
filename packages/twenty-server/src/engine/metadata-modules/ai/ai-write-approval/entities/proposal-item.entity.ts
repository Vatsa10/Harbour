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

import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import {
  ProposalActionType,
  ProposalItemStatus,
} from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';

@Entity({ name: 'proposalItem', schema: 'core' })
export class ProposalItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  @Index()
  proposalId: string;

  @ManyToOne(() => ProposalEntity, (proposal) => proposal.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'proposalId' })
  proposal: Relation<ProposalEntity>;

  @Column({ type: 'varchar' })
  actionType: ProposalActionType;

  @Column({ type: 'varchar', nullable: true })
  objectNameSingular: string | null;

  @Column({ type: 'uuid', nullable: true })
  recordId: string | null;

  // Set for static-tool items so approval can replay the call through the
  // provider that owns it.
  @Column({ type: 'varchar', nullable: true })
  toolId: string | null;

  @Column({ type: 'varchar', nullable: true })
  toolCategory: string | null;

  // Proposed values for a record write, or the message payload for a send.
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload: Record<string, unknown>;

  // Field values observed when the proposal was created. Re-read at approval
  // time to detect that a human changed the record in the meantime.
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  baseline: Record<string, unknown>;

  @Column({ type: 'varchar', default: ProposalItemStatus.PENDING })
  status: ProposalItemStatus;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'uuid', nullable: true })
  resultRecordId: string | null;

  // Fact rows current for the touched fields when this item was created.
  // Empty for writes with no research behind them (chat, manual tool calls) —
  // the honest state: no evidence backs those.
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  factIds: string[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
