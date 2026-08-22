import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('2.28.0', 1786500000000)
export class AddRecordBriefFastInstanceCommand implements FastInstanceCommand {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "core"."recordBrief" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "workspaceId" uuid NOT NULL,
        "objectNameSingular" varchar NOT NULL,
        "recordId" uuid NOT NULL,
        "narrative" text NOT NULL,
        "sections" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "factIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "oldestObservedAt" timestamptz NOT NULL,
        "refreshedAt" timestamptz NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_recordBrief" PRIMARY KEY ("id"),
        CONSTRAINT "FK_recordBrief_workspace" FOREIGN KEY ("workspaceId")
          REFERENCES "core"."workspace"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_recordBrief_workspaceId" ON "core"."recordBrief" ("workspaceId")`,
    );
    // One brief per record, always replaced — the upsert in RecordBriefService
    // resolves on exactly these three columns, so the constraint is what makes
    // "no history, no duplicates" true in the database and not just in code.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_RECORD_BRIEF_RECORD_UNIQUE" ON "core"."recordBrief" ("workspaceId", "objectNameSingular", "recordId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "core"."recordBrief"`);
  }
}
