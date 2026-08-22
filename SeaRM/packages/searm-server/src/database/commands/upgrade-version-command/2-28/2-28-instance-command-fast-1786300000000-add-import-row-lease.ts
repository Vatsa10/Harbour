import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

// Charter contract 2: workflows and agents are "leased". Import row claiming
// had neither a lease nor an atomic claim — executeBatch read status =
// 'PENDING' and only wrote each row's outcome afterwards, so nothing marked a
// row in-flight. Two concurrent executions of the same batch processed the
// same chunk and double-wrote. That was masked only by concurrency: 1 on
// importQueue in a single worker process, and would break on a second replica.
//
// leasedAt is what makes the claim recoverable: a worker that dies mid-chunk
// leaves rows IN_PROGRESS, and without an expiry they would be stranded
// forever — strictly worse than the double-write it replaces.
@RegisteredInstanceCommand('2.28.0', 1786300000000)
export class AddImportRowLeaseFastInstanceCommand
  implements FastInstanceCommand
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "core"."importRow" ADD COLUMN "leasedAt" timestamptz`,
    );
    // Supports the claim query's "PENDING or expired lease, oldest first"
    // predicate without scanning the whole batch.
    await queryRunner.query(
      `CREATE INDEX "IDX_importRow_claim"
         ON "core"."importRow" ("importBatchId", "status", "leasedAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "core"."IDX_importRow_claim"`);
    await queryRunner.query(
      `ALTER TABLE "core"."importRow" DROP COLUMN "leasedAt"`,
    );
  }
}
