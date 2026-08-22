import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

// A separate command rather than an edit to 1785950948000: that one is
// committed, and rewriting a shipped command's up/down leaves any database
// that already ran it permanently out of step with the code.
@RegisteredInstanceCommand('2.28.0', 1786001200000)
export class AddProposalItemFactIdsFastInstanceCommand
  implements FastInstanceCommand
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "core"."proposalItem"
       ADD COLUMN IF NOT EXISTS "factIds" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "core"."proposalItem" DROP COLUMN IF EXISTS "factIds"`,
    );
  }
}
