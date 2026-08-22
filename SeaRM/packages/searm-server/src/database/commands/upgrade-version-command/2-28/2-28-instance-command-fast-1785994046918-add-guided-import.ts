import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('2.28.0', 1785994046918)
export class AddGuidedImportFastInstanceCommand implements FastInstanceCommand {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "core"."importBatch" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "workspaceId" uuid NOT NULL,
        "objectNameSingular" varchar NOT NULL,
        "fileName" varchar NOT NULL,
        "status" varchar NOT NULL DEFAULT 'PENDING',
        "mappingConfig" jsonb,
        "totalRows" int NOT NULL DEFAULT 0,
        "processedRows" int NOT NULL DEFAULT 0,
        "createdRowCount" int NOT NULL DEFAULT 0,
        "updatedRowCount" int NOT NULL DEFAULT 0,
        "proposedRowCount" int NOT NULL DEFAULT 0,
        "skippedRowCount" int NOT NULL DEFAULT 0,
        "failedRowCount" int NOT NULL DEFAULT 0,
        "createdByUserWorkspaceId" uuid,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_importBatch" PRIMARY KEY ("id"),
        CONSTRAINT "FK_importBatch_workspace" FOREIGN KEY ("workspaceId")
          REFERENCES "core"."workspace"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_importBatch_workspaceId" ON "core"."importBatch" ("workspaceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_importBatch_status" ON "core"."importBatch" ("status")`,
    );
    await queryRunner.query(
      `CREATE TABLE "core"."importRow" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "importBatchId" uuid NOT NULL,
        "rowNumber" int NOT NULL,
        "rawData" jsonb NOT NULL,
        "mappedData" jsonb,
        "matchAction" varchar,
        "matchedRecordId" uuid,
        "validationErrors" jsonb,
        "status" varchar NOT NULL DEFAULT 'PENDING',
        "errorMessage" text,
        "processedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_importRow" PRIMARY KEY ("id"),
        CONSTRAINT "FK_importRow_importBatch" FOREIGN KEY ("importBatchId")
          REFERENCES "core"."importBatch"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_importRow_importBatchId" ON "core"."importRow" ("importBatchId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_importRow_importBatchId_status" ON "core"."importRow" ("importBatchId", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "core"."importRow"`);
    await queryRunner.query(`DROP TABLE "core"."importBatch"`);
  }
}
