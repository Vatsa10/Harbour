import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('2.28.0', 1785950948000)
export class AddAiWriteApprovalFastInstanceCommand implements FastInstanceCommand {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "core"."proposal" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "workspaceId" uuid NOT NULL,
        "status" varchar NOT NULL DEFAULT 'PENDING',
        "createdByActor" jsonb,
        "threadId" uuid,
        "expiresAt" timestamptz NOT NULL,
        "reviewedByUserWorkspaceId" uuid,
        "reviewedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_proposal" PRIMARY KEY ("id"),
        CONSTRAINT "FK_proposal_workspace" FOREIGN KEY ("workspaceId")
          REFERENCES "core"."workspace"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proposal_workspaceId" ON "core"."proposal" ("workspaceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proposal_status" ON "core"."proposal" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proposal_threadId" ON "core"."proposal" ("threadId")`,
    );
    await queryRunner.query(
      `CREATE TABLE "core"."proposalItem" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "proposalId" uuid NOT NULL,
        "actionType" varchar NOT NULL,
        "objectNameSingular" varchar,
        "recordId" uuid,
        "toolId" varchar,
        "toolCategory" varchar,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "baseline" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "status" varchar NOT NULL DEFAULT 'PENDING',
        "error" text,
        "resultRecordId" uuid,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_proposalItem" PRIMARY KEY ("id"),
        CONSTRAINT "FK_proposalItem_proposal" FOREIGN KEY ("proposalId")
          REFERENCES "core"."proposal"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proposalItem_proposalId" ON "core"."proposalItem" ("proposalId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "core"."proposalItem"`);
    await queryRunner.query(`DROP TABLE "core"."proposal"`);
  }
}
