import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

// Stage 3 carried defect 3.1: ProposalGateService.getOrCreatePendingProposal
// is a read-then-insert with no lock behind it. Two tool calls from the same
// agent turn (concurrent execution inside one turn, or a retried call racing
// the original) can both miss the find() and both insert a PENDING proposal
// for the same (workspaceId, threadId) — the reviewer then sees two cards for
// one turn instead of one batch. Same class of bug as
// IDX_PROPOSAL_SOURCE_KEY_UNIQUE one migration back, and the same fix: let
// the database settle the race instead of trusting the read.
//
// Scoped to `status = 'PENDING'` rather than unconditional: a workspace's
// history legitimately holds many APPLIED/REJECTED/EXPIRED proposals sharing
// a threadId (one per turn, over time), and threadId is nullable for the
// background-job path that keys on sourceKey instead. Constraining only the
// open row per thread is exactly the invariant getOrCreatePendingProposal
// already assumes but never enforced.
@RegisteredInstanceCommand('2.28.0', 1786600000000)
export class AddProposalThreadPendingUniquenessFastInstanceCommand
  implements FastInstanceCommand
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Existing duplicates would abort the index build. Keep the oldest
    // PENDING proposal per thread — the one earlier tool calls in the turn
    // already reference — and fail the rest out so the index reflects the
    // world going forward rather than silently hiding a card a reviewer may
    // already be looking at.
    await queryRunner.query(
      `WITH ranked AS (
         SELECT "id",
                row_number() OVER (
                  PARTITION BY "workspaceId", "threadId"
                  ORDER BY "createdAt" ASC, "id" ASC
                ) AS "rowNumber"
         FROM "core"."proposal"
         WHERE "status" = 'PENDING' AND "threadId" IS NOT NULL
       )
       UPDATE "core"."proposal" AS p
       SET "status" = 'FAILED'
       FROM ranked
       WHERE p."id" = ranked."id" AND ranked."rowNumber" > 1`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_PROPOSAL_THREAD_PENDING_UNIQUE"
         ON "core"."proposal" ("workspaceId", "threadId")
         WHERE "status" = 'PENDING' AND "threadId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "core"."IDX_PROPOSAL_THREAD_PENDING_UNIQUE"`,
    );
  }
}
