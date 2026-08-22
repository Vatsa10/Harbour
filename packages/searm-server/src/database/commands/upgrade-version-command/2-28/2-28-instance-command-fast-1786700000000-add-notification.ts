import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

// The in-app notification primitive. New table only — nothing existing changes
// meaning, so an instance that has not yet deployed the notification code is
// unaffected by having run this.
@RegisteredInstanceCommand('2.28.0', 1786700000000)
export class AddNotificationFastInstanceCommand implements FastInstanceCommand {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "core"."notification" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "workspaceId" uuid NOT NULL,
         "userWorkspaceId" uuid,
         "title" varchar NOT NULL,
         "body" text,
         "linkPath" varchar,
         "dedupeKey" varchar,
         "readAt" timestamptz,
         "createdAt" timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT "PK_NOTIFICATION" PRIMARY KEY ("id"),
         CONSTRAINT "FK_NOTIFICATION_WORKSPACE" FOREIGN KEY ("workspaceId")
           REFERENCES "core"."workspace"("id") ON DELETE CASCADE
       )`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_NOTIFICATION_WORKSPACE_ID"
       ON "core"."notification" ("workspaceId")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_NOTIFICATION_USER_WORKSPACE_ID"
       ON "core"."notification" ("userWorkspaceId")`,
    );

    // The bell's only query: unread rows for one workspace.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_NOTIFICATION_WORKSPACE_UNREAD"
       ON "core"."notification" ("workspaceId", "readAt")`,
    );

    // Idempotency, per the execution contract: a retried job that raises the
    // same notification twice gets one row. Partial so that the many rows
    // raised without a key do not collide with each other.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_NOTIFICATION_DEDUPE_UNIQUE"
       ON "core"."notification" ("workspaceId", "dedupeKey")
       WHERE "dedupeKey" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "core"."notification"`);
  }
}
