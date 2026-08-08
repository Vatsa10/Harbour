import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';
import { v4 as uuidv4 } from 'uuid';

import { RecordPositionService } from 'src/engine/core-modules/record-position/services/record-position.service';
import { WorkflowVersionCoreSyncService } from 'src/engine/core-modules/workflow/services/workflow-version-core-sync.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import {
  WorkflowVersionStatus,
  type WorkflowVersionWorkspaceEntity,
} from 'src/modules/workflow/common/standard-objects/workflow-version.workspace-entity';
import {
  WorkflowStatus,
  type WorkflowWorkspaceEntity,
} from 'src/modules/workflow/common/standard-objects/workflow.workspace-entity';
import { type WorkflowAction } from 'src/modules/workflow/workflow-executor/workflow-actions/types/workflow-action.type';
import { WORKFLOW_TEMPLATES } from 'src/modules/workflow/workflow-templates/constants/workflow-templates.const';
import {
  type WorkflowDefinitionInput,
  type WorkflowTemplateDefinition,
  type WorkflowTemplateKey,
} from 'src/modules/workflow/workflow-templates/types/workflow-template.type';
import { normalizeWorkflowTemplateSteps } from 'src/modules/workflow/workflow-templates/utils/normalize-workflow-template-steps.util';
import { WorkflowTriggerWorkspaceService } from 'src/modules/workflow/workflow-trigger/workspace-services/workflow-trigger.workspace-service';
import { type WorkflowTrigger } from 'src/modules/workflow/workflow-trigger/types/workflow-trigger.type';

export type InstalledWorkflow = {
  workflowId: string;
  workflowVersionId: string;
};

@Injectable()
export class WorkflowTemplateService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly recordPositionService: RecordPositionService,
    private readonly workflowVersionCoreSyncService: WorkflowVersionCoreSyncService,
    private readonly workflowTriggerService: WorkflowTriggerWorkspaceService,
  ) {}

  list(): WorkflowTemplateDefinition[] {
    return WORKFLOW_TEMPLATES;
  }

  async install(params: {
    key: WorkflowTemplateKey;
    workspaceId: string;
    activate: boolean;
  }): Promise<InstalledWorkflow> {
    const { key, workspaceId, activate } = params;

    const template = WORKFLOW_TEMPLATES.find((entry) => entry.key === key);

    if (!isDefined(template)) {
      throw new Error(`Unknown workflow template "${key}"`);
    }

    return this.installDefinition({
      definition: template,
      workspaceId,
      activate,
    });
  }

  // The one workflow-creation implementation in the product. Built-in
  // templates go through install() above; an installable application supplies
  // its own definition here (Phase 5), instead of hand-rolling createWorkflow /
  // createWorkflowVersionStep / activateWorkflowVersion GraphQL calls from a
  // post-install hook.
  async installDefinition(params: {
    definition: WorkflowDefinitionInput;
    workspaceId: string;
    activate: boolean;
  }): Promise<InstalledWorkflow> {
    const { definition, workspaceId, activate } = params;

    // Idempotent by name: re-running an app's post-install hook, or
    // reinstalling the app, must not create a second copy of the workflow.
    const existing = await this.findWorkflowByName(
      workspaceId,
      definition.name,
    );

    if (isDefined(existing)) {
      return existing;
    }

    const workflowId = await this.createWorkflow(workspaceId, definition.name);
    const workflowVersionId = await this.createWorkflowVersion(
      workspaceId,
      workflowId,
      {
        trigger: definition.trigger,
        // An app supplies {type, name, settings} only. Steps are stored as
        // JSON, so a step with no id survives the insert and only fails when
        // the executor reaches it.
        steps: normalizeWorkflowTemplateSteps(definition.steps),
      },
    );

    if (activate) {
      await this.workflowTriggerService.activateWorkflowVersion(
        workflowVersionId,
        workspaceId,
      );
      await this.markWorkflowActive(workspaceId, workflowId, workflowVersionId);
    }

    return { workflowId, workflowVersionId };
  }

  private async createWorkflow(
    workspaceId: string,
    name: string,
  ): Promise<string> {
    const authContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const workflowRepository =
          await this.globalWorkspaceOrmManager.getRepository<WorkflowWorkspaceEntity>(
            workspaceId,
            'workflow',
            // A template install is system-originated and has no calling
            // user's role, so the bypass form is the correct one here.
            { shouldBypassPermissionChecks: true },
          );

        const position = await this.recordPositionService.buildRecordPosition({
          value: 'first',
          objectMetadata: { isCustom: false, nameSingular: 'workflow' },
          workspaceId,
        });

        const workflow = {
          id: uuidv4(),
          name,
          statuses: [WorkflowStatus.DRAFT],
          position,
        };

        await workflowRepository.insert(workflow);

        return workflow.id;
      },
      authContext,
    );
  }

  private async createWorkflowVersion(
    workspaceId: string,
    workflowId: string,
    template: { trigger: WorkflowTrigger; steps: WorkflowAction[] },
  ): Promise<string> {
    const workflowVersionId = uuidv4();

    await this.workflowVersionCoreSyncService.writeWorkflowVersionAndMirror(
      workspaceId,
      async (workflowVersionRepository, entityManager) => {
        const position = await this.recordPositionService.buildRecordPosition({
          value: 'first',
          objectMetadata: { isCustom: false, nameSingular: 'workflowVersion' },
          workspaceId,
        });

        await workflowVersionRepository.insert(
          {
            id: workflowVersionId,
            workflowId,
            name: 'v1',
            status: WorkflowVersionStatus.DRAFT,
            trigger: template.trigger,
            steps: template.steps,
            position,
          },
          entityManager,
        );

        return workflowVersionId;
      },
    );

    return workflowVersionId;
  }

  private async markWorkflowActive(
    workspaceId: string,
    workflowId: string,
    workflowVersionId: string,
  ): Promise<void> {
    const authContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const workflowRepository =
        await this.globalWorkspaceOrmManager.getRepository<WorkflowWorkspaceEntity>(
          workspaceId,
          'workflow',
          { shouldBypassPermissionChecks: true },
        );

      await workflowRepository.update(workflowId, {
        statuses: [WorkflowStatus.ACTIVE],
        lastPublishedVersionId: workflowVersionId,
      });
    }, authContext);
  }

  // The whole of installDefinition's idempotency. A post-install hook re-runs
  // on every app upgrade, so "already installed" must be a cheap, total lookup
  // rather than a duplicate workflow.
  async findWorkflowByName(
    workspaceId: string,
    name: string,
  ): Promise<InstalledWorkflow | null> {
    const authContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const workflowRepository =
          await this.globalWorkspaceOrmManager.getRepository<WorkflowWorkspaceEntity>(
            workspaceId,
            'workflow',
            { shouldBypassPermissionChecks: true },
          );

        const workflow = await workflowRepository.findOne({ where: { name } });

        if (!isDefined(workflow)) {
          return null;
        }

        if (isDefined(workflow.lastPublishedVersionId)) {
          return {
            workflowId: workflow.id,
            workflowVersionId: workflow.lastPublishedVersionId,
          };
        }

        // No published version: fall back to the workflow's own draft, which
        // is what install() leaves behind when activate is false. Ordered by
        // createdAt DESC so "latest draft" is deterministic when a user has
        // added versions in the builder since the app installed.
        const workflowVersionRepository =
          await this.globalWorkspaceOrmManager.getRepository<WorkflowVersionWorkspaceEntity>(
            workspaceId,
            'workflowVersion',
            { shouldBypassPermissionChecks: true },
          );

        const draftVersion = await workflowVersionRepository.findOne({
          where: {
            workflowId: workflow.id,
            status: WorkflowVersionStatus.DRAFT,
          },
          order: { createdAt: 'DESC' },
        });

        if (!isDefined(draftVersion)) {
          return null;
        }

        return {
          workflowId: workflow.id,
          workflowVersionId: draftVersion.id,
        };
      },
      authContext,
    );
  }
}
