import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

// Charter contract 2: "a retry must never duplicate a fact." Until now that
// invariant had no constraint behind it — FactDerivationService did a
// read-then-write with no lock, and IDX_FACT_CURRENT_LOOKUP is a plain index.
// Two concurrent record_evidence calls for the same (recordId, fieldName) both
// saw no CURRENT fact and both inserted one, after which the approval UI
// rendered two citations for one row and supersession only ever fixed one.
//
// The index is deliberately narrower than "WHERE status = 'CURRENT'": the
// same-run contradiction rule in FactDerivationService keeps BOTH claims
// CURRENT with hasConflict = true on purpose, so a reviewer sees the
// disagreement instead of one arbitrary winner. Constraining only the
// uncontested rows still closes the race — two concurrent first observations
// both insert hasConflict = false — while leaving the deliberate pair legal.
//
// Same shape one table over: proposal.sourceKey is the idempotency key for
// ingestion/import batches and had only a plain index behind its
// find-then-save dedupe.
@RegisteredInstanceCommand('2.28.0', 1786200000000)
export class AddFactAndProposalUniquenessFastInstanceCommand
  implements FastInstanceCommand
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Existing duplicates would abort the index build. Keep the newest CURRENT
    // row per key and supersede the rest, pointing each at its survivor so the
    // history stays traversable — the same shape deriveFact's supersession
    // writes.
    await queryRunner.query(
      `WITH ranked AS (
         SELECT "id",
                first_value("id") OVER (
                  PARTITION BY "workspaceId", "objectNameSingular", "recordId", "fieldName"
                  ORDER BY "lastObservedAt" DESC, "createdAt" DESC, "id" DESC
                ) AS "keptId",
                row_number() OVER (
                  PARTITION BY "workspaceId", "objectNameSingular", "recordId", "fieldName"
                  ORDER BY "lastObservedAt" DESC, "createdAt" DESC, "id" DESC
                ) AS "rowNumber"
         FROM "core"."fact"
         WHERE "status" = 'CURRENT' AND "hasConflict" = false
       )
       UPDATE "core"."fact" AS f
       SET "status" = 'SUPERSEDED',
           "supersededAt" = now(),
           "supersededByFactId" = ranked."keptId"
       FROM ranked
       WHERE f."id" = ranked."id" AND ranked."rowNumber" > 1`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_FACT_CURRENT_UNIQUE"
         ON "core"."fact" ("workspaceId", "objectNameSingular", "recordId", "fieldName")
         WHERE "status" = 'CURRENT' AND "hasConflict" = false`,
    );

    // Keep the earliest proposal per source key; later ones are the duplicate
    // the dedupe read was supposed to prevent.
    await queryRunner.query(
      `WITH ranked AS (
         SELECT "id",
                row_number() OVER (
                  PARTITION BY "workspaceId", "sourceKey"
                  ORDER BY "createdAt" ASC, "id" ASC
                ) AS "rowNumber"
         FROM "core"."proposal"
         WHERE "sourceKey" IS NOT NULL
       )
       UPDATE "core"."proposal" AS p
       SET "sourceKey" = p."sourceKey" || ':duplicate:' || p."id"
       FROM ranked
       WHERE p."id" = ranked."id" AND ranked."rowNumber" > 1`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_PROPOSAL_SOURCE_KEY_UNIQUE"
         ON "core"."proposal" ("workspaceId", "sourceKey")
         WHERE "sourceKey" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "core"."IDX_PROPOSAL_SOURCE_KEY_UNIQUE"`,
    );
    await queryRunner.query(`DROP INDEX "core"."IDX_FACT_CURRENT_UNIQUE"`);
  }
}
