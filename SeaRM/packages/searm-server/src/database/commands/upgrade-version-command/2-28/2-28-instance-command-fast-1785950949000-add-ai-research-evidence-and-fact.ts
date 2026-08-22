import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('2.28.0', 1785950949000)
export class AddAiResearchEvidenceAndFactFastInstanceCommand
  implements FastInstanceCommand
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "core"."evidence" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "workspaceId" uuid NOT NULL,
        "objectNameSingular" varchar NOT NULL,
        "recordId" uuid NOT NULL,
        "runId" uuid,
        "sourceType" varchar NOT NULL,
        "sourceLocator" text NOT NULL,
        "observedAt" timestamptz NOT NULL,
        "extractor" varchar NOT NULL,
        "payload" jsonb NOT NULL,
        "payloadHash" varchar(64) NOT NULL,
        "strength" varchar NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_evidence" PRIMARY KEY ("id"),
        CONSTRAINT "FK_evidence_workspace" FOREIGN KEY ("workspaceId")
          REFERENCES "core"."workspace"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_evidence_workspaceId" ON "core"."evidence" ("workspaceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_evidence_runId" ON "core"."evidence" ("runId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_EVIDENCE_RECORD" ON "core"."evidence" ("workspaceId", "objectNameSingular", "recordId")`,
    );

    await queryRunner.query(
      `CREATE TABLE "core"."fact" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "workspaceId" uuid NOT NULL,
        "objectNameSingular" varchar NOT NULL,
        "recordId" uuid NOT NULL,
        "fieldName" varchar NOT NULL,
        "value" jsonb NOT NULL,
        "status" varchar NOT NULL DEFAULT 'CURRENT',
        "hasConflict" boolean NOT NULL DEFAULT false,
        "strength" varchar NOT NULL,
        "evidenceIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "runId" uuid,
        "lastObservedAt" timestamptz NOT NULL,
        "supersededAt" timestamptz,
        "supersededByFactId" uuid,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fact" PRIMARY KEY ("id"),
        CONSTRAINT "FK_fact_workspace" FOREIGN KEY ("workspaceId")
          REFERENCES "core"."workspace"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fact_workspaceId" ON "core"."fact" ("workspaceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fact_recordId" ON "core"."fact" ("recordId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_FACT_CURRENT_LOOKUP" ON "core"."fact" ("workspaceId", "objectNameSingular", "recordId", "fieldName", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "core"."fact"`);
    await queryRunner.query(`DROP TABLE "core"."evidence"`);
  }
}
