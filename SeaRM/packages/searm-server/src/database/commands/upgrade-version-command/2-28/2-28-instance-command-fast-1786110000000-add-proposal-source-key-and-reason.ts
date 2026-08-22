import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('2.28.0', 1786110000000)
export class AddProposalSourceKeyAndReasonFastInstanceCommand implements FastInstanceCommand {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "core"."proposal" ADD COLUMN "sourceKey" varchar`,
    );
    await queryRunner.query(
      `ALTER TABLE "core"."proposal" ADD COLUMN "reason" text`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proposal_sourceKey" ON "core"."proposal" ("sourceKey")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "core"."IDX_proposal_sourceKey"`);
    await queryRunner.query(
      `ALTER TABLE "core"."proposal" DROP COLUMN "reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "core"."proposal" DROP COLUMN "sourceKey"`,
    );
  }
}
