import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

// Proposal supersession: the columns behind ProposalStatus.SUPERSEDED and
// ProposalItemStatus.SUPERSEDED. Additive only — no existing status value
// changes meaning, and nothing is dropped, so a database that ran the earlier
// AI-write-approval commands stays readable by the previous code.
@RegisteredInstanceCommand('2.28.0', 1786400000000)
export class AddProposalSupersessionFastInstanceCommand
  implements FastInstanceCommand
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "core"."proposal"
       ADD COLUMN IF NOT EXISTS "supersededAt" timestamptz`,
    );

    await queryRunner.query(
      `ALTER TABLE "core"."proposalItem"
       ADD COLUMN IF NOT EXISTS "supersededAt" timestamptz,
       ADD COLUMN IF NOT EXISTS "supersededByProposalItemId" uuid,
       ADD COLUMN IF NOT EXISTS "supersessionReason" varchar`,
    );

    // The overlap search runs on every proposal creation: find pending items
    // for these record ids. Without this index it is a sequential scan of
    // every proposalItem row in the instance on the hot write path.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_PROPOSAL_ITEM_PENDING_RECORD"
       ON "core"."proposalItem" ("recordId", "status")
       WHERE "recordId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "core"."IDX_PROPOSAL_ITEM_PENDING_RECORD"`,
    );
    await queryRunner.query(
      `ALTER TABLE "core"."proposalItem"
       DROP COLUMN IF EXISTS "supersededAt",
       DROP COLUMN IF EXISTS "supersededByProposalItemId",
       DROP COLUMN IF EXISTS "supersessionReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "core"."proposal" DROP COLUMN IF EXISTS "supersededAt"`,
    );
  }
}
