import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('2.28.0', 1785988945212)
export class AddAiResearchAgentTaskAndRunFastInstanceCommand
  implements FastInstanceCommand
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "core"."agentTask" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "workspaceId" uuid NOT NULL,
        "objectNameSingular" varchar NOT NULL,
        "recordId" uuid NOT NULL,
        "agentId" uuid NOT NULL,
        "reason" text NOT NULL,
        "priority" int NOT NULL DEFAULT 0,
        "budget" int NOT NULL DEFAULT 8,
        "status" varchar NOT NULL DEFAULT 'PENDING',
        "dueAt" timestamptz NOT NULL DEFAULT now(),
        "leasedUntil" timestamptz,
        "attempts" int NOT NULL DEFAULT 0,
        "maxAttempts" int NOT NULL DEFAULT 3,
        "idempotencyKey" varchar,
        "cancelledAt" timestamptz,
        "cancelReason" text,
        "lastRunId" uuid,
        "outcome" text,
        "createdByActor" jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agentTask" PRIMARY KEY ("id"),
        CONSTRAINT "FK_agentTask_workspace" FOREIGN KEY ("workspaceId")
          REFERENCES "core"."workspace"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_AGENT_TASK_WORKSPACE_ID" ON "core"."agentTask" ("workspaceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_AGENT_TASK_RECORD_ID" ON "core"."agentTask" ("recordId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_AGENT_TASK_STATUS" ON "core"."agentTask" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_AGENT_TASK_DUE_LEASE" ON "core"."agentTask" ("dueAt", "leasedUntil")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_AGENT_TASK_IDEMPOTENCY_KEY" ON "core"."agentTask" ("workspaceId", "idempotencyKey")
        WHERE "idempotencyKey" IS NOT NULL AND "status" IN ('PENDING', 'LEASED')`,
    );

    await queryRunner.query(
      `CREATE TABLE "core"."agentRun" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "workspaceId" uuid NOT NULL,
        "taskId" uuid,
        "agentId" uuid NOT NULL,
        "workflowRunId" uuid,
        "status" varchar NOT NULL DEFAULT 'RUNNING',
        "modelId" varchar,
        "startedAt" timestamptz NOT NULL DEFAULT now(),
        "finishedAt" timestamptz,
        "elapsedMs" int,
        "inputTokens" int NOT NULL DEFAULT 0,
        "outputTokens" int NOT NULL DEFAULT 0,
        "creditsUsedMicro" bigint NOT NULL DEFAULT 0,
        "resultSummary" text,
        "errorMessage" text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agentRun" PRIMARY KEY ("id"),
        CONSTRAINT "FK_agentRun_workspace" FOREIGN KEY ("workspaceId")
          REFERENCES "core"."workspace"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_agentRun_task" FOREIGN KEY ("taskId")
          REFERENCES "core"."agentTask"("id") ON DELETE SET NULL
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_AGENT_RUN_WORKSPACE_ID" ON "core"."agentRun" ("workspaceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_AGENT_RUN_TASK_ID" ON "core"."agentRun" ("taskId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_AGENT_RUN_WORKFLOW_RUN_ID" ON "core"."agentRun" ("workflowRunId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "core"."agentRun"`);
    await queryRunner.query(`DROP TABLE "core"."agentTask"`);
  }
}
