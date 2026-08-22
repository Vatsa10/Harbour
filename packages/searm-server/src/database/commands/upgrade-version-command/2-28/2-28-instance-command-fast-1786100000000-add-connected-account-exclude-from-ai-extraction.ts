import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

// Owner Decision 3: per-connected-account opt-out from sending message and
// call-recording content to a third-party LLM. Defaults to false so existing
// accounts keep today's behaviour; a workspace opts an account out explicitly.
@RegisteredInstanceCommand('2.28.0', 1786100000000)
export class AddConnectedAccountExcludeFromAiExtractionFastInstanceCommand
  implements FastInstanceCommand
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "core"."connectedAccount"
       ADD COLUMN IF NOT EXISTS "excludeFromAiExtraction" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "core"."connectedAccount" DROP COLUMN IF EXISTS "excludeFromAiExtraction"`,
    );
  }
}
