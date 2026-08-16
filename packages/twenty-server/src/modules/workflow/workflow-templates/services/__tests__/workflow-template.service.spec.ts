import { Test, type TestingModule } from '@nestjs/testing';

import { WorkflowActionType } from 'twenty-shared/workflow';

import { RecordPositionService } from 'src/engine/core-modules/record-position/services/record-position.service';
import { WorkflowVersionCoreSyncService } from 'src/engine/core-modules/workflow/services/workflow-version-core-sync.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { WorkflowTemplateService } from 'src/modules/workflow/workflow-templates/services/workflow-template.service';
import { buildInstalledWorkflowId } from 'src/modules/workflow/workflow-templates/utils/build-installed-workflow-id.util';
import { InvalidWorkflowDefinitionError } from 'src/modules/workflow/workflow-templates/utils/validate-workflow-template-definition.util';
import { type WorkflowStepInput } from 'src/modules/workflow/workflow-templates/types/workflow-template.type';
import { WorkflowTriggerWorkspaceService } from 'src/modules/workflow/workflow-trigger/workspace-services/workflow-trigger.workspace-service';
import {
  type WorkflowTrigger,
  WorkflowTriggerType,
} from 'src/modules/workflow/workflow-trigger/types/workflow-trigger.type';

const manualTrigger: WorkflowTrigger = {
  name: 'Manual trigger',
  type: WorkflowTriggerType.MANUAL,
  settings: { outputSchema: {} },
};

// Exactly Phase 5's WorkflowStepTemplate: {type, name, settings} and nothing
// else — no id, no valid, no nextStepIds.
const appSuppliedStep: WorkflowStepInput = {
  type: WorkflowActionType.AI_AGENT,
  name: 'Triage',
  settings: {
    outputSchema: {},
    errorHandlingOptions: {
      retryOnFailure: { value: false },
      continueOnFailure: { value: false },
    },
    input: { prompt: 'do the thing' },
  },
};

describe('WorkflowTemplateService', () => {
  let service: WorkflowTemplateService;

  const workflowRepository = {
    insert: jest.fn(),
    update: jest.fn(),
    // findWorkflowByName's idempotency lookup; default "not installed yet".
    findOne: jest.fn(),
  };
  // Shared, not inline, so the install tests can inspect the stored steps.
  const workflowVersionRepository = { insert: jest.fn(), findOne: jest.fn() };
  const globalWorkspaceOrmManager = {
    executeInWorkspaceContext: jest.fn((fn: () => unknown) => fn()),
    getRepository: jest.fn(
      async (_workspaceId: string, objectMetadataName: string) =>
        objectMetadataName === 'workflowVersion'
          ? workflowVersionRepository
          : workflowRepository,
    ),
  };
  const recordPositionService = {
    buildRecordPosition: jest.fn().mockResolvedValue(1),
  };
  const workflowVersionCoreSyncService = {
    writeWorkflowVersionAndMirror: jest.fn(
      async (
        _workspaceId: string,
        callback: (repo: unknown, manager: unknown) => Promise<unknown>,
      ) => callback(workflowVersionRepository, {}),
    ),
  };
  const workflowTriggerService = {
    activateWorkflowVersion: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    workflowRepository.findOne.mockResolvedValue(null);
    workflowVersionRepository.findOne.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowTemplateService,
        {
          provide: GlobalWorkspaceOrmManager,
          useValue: globalWorkspaceOrmManager,
        },
        { provide: RecordPositionService, useValue: recordPositionService },
        {
          provide: WorkflowVersionCoreSyncService,
          useValue: workflowVersionCoreSyncService,
        },
        {
          provide: WorkflowTriggerWorkspaceService,
          useValue: workflowTriggerService,
        },
      ],
    }).compile();

    service = module.get<WorkflowTemplateService>(WorkflowTemplateService);
  });

  it('should look the existing install up by the installer-owned id, not by name', async () => {
    await service.installDefinition({
      definition: {
        name: 'New ticket triage',
        trigger: manualTrigger,
        steps: [appSuppliedStep],
      },
      workspaceId: 'workspace-1',
      activate: false,
    });

    const expectedId = buildInstalledWorkflowId(
      'workspace-1',
      'New ticket triage',
    );

    // A user's hand-built "New ticket triage" must not answer this lookup.
    expect(workflowRepository.findOne).toHaveBeenCalledWith({
      where: { id: expectedId },
    });
    expect(workflowRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ id: expectedId }),
    );
  });

  it.each([
    ['an unknown trigger type', { type: 'NOT_A_TRIGGER', name: 'x' }, [appSuppliedStep]],
    ['no steps at all', manualTrigger, []],
  ])('should refuse a definition with %s', async (_label, trigger, steps) => {
    await expect(
      service.installDefinition({
        definition: {
          name: 'Malformed',
          trigger: trigger as never,
          steps: steps as never,
        },
        workspaceId: 'workspace-1',
        activate: true,
      }),
    ).rejects.toThrow(InvalidWorkflowDefinitionError);

    expect(workflowRepository.insert).not.toHaveBeenCalled();
    expect(
      workflowTriggerService.activateWorkflowVersion,
    ).not.toHaveBeenCalled();
  });

  it('should refuse a step with an unknown action type before inserting anything', async () => {
    await expect(
      service.installDefinition({
        definition: {
          name: 'Malformed',
          trigger: manualTrigger,
          steps: [
            { type: 'DROP_EVERYTHING', name: 'boom', settings: {} } as never,
          ],
        },
        workspaceId: 'workspace-1',
        activate: true,
      }),
    ).rejects.toThrow(/unknown type "DROP_EVERYTHING"/);

    expect(workflowVersionRepository.insert).not.toHaveBeenCalled();
  });

  it('should refuse a step with no settings object', async () => {
    await expect(
      service.installDefinition({
        definition: {
          name: 'Malformed',
          trigger: manualTrigger,
          steps: [{ type: WorkflowActionType.AI_AGENT, name: 'x' } as never],
        },
        workspaceId: 'workspace-1',
        activate: true,
      }),
    ).rejects.toThrow(/missing a settings object/);

    expect(workflowRepository.insert).not.toHaveBeenCalled();
  });

  it('should list exactly the three named templates', () => {
    const templates = service.list();

    expect(templates.map((template) => template.key)).toEqual([
      'RESEARCH_BRIEF',
      'FOLLOW_UP_DIGEST',
      'ACCOUNT_MONITORING',
    ]);
  });

  it('should create a workflow row for an installed template', async () => {
    await service.install({
      key: 'RESEARCH_BRIEF',
      workspaceId: 'workspace-1',
      activate: false,
    });

    expect(workflowRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Research brief' }),
    );
  });

  it('should store the real catalog trigger and steps for an installed template', async () => {
    await service.install({
      key: 'FOLLOW_UP_DIGEST',
      workspaceId: 'workspace-1',
      activate: false,
    });

    const [insertedVersion] = workflowVersionRepository.insert.mock.calls[0];

    expect(insertedVersion.trigger).toMatchObject({
      type: WorkflowTriggerType.CRON,
      settings: { type: 'HOURS', schedule: { hour: 8, minute: 0 } },
    });
    expect(insertedVersion.steps).toHaveLength(1);
    expect(insertedVersion.steps[0]).toMatchObject({
      type: WorkflowActionType.AI_AGENT,
      valid: true,
      nextStepIds: [],
    });
    expect(
      insertedVersion.steps[0].settings.errorHandlingOptions,
    ).toBeDefined();
  });

  it('should not activate the workflow unless activate is true', async () => {
    await service.install({
      key: 'RESEARCH_BRIEF',
      workspaceId: 'workspace-1',
      activate: false,
    });

    expect(
      workflowTriggerService.activateWorkflowVersion,
    ).not.toHaveBeenCalled();
  });

  it('should activate the workflow and set it ACTIVE when activate is true', async () => {
    await service.install({
      key: 'FOLLOW_UP_DIGEST',
      workspaceId: 'workspace-1',
      activate: true,
    });

    expect(workflowTriggerService.activateWorkflowVersion).toHaveBeenCalled();
    expect(workflowRepository.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ statuses: ['ACTIVE'] }),
    );
  });

  it('should throw for an unknown template key', async () => {
    await expect(
      service.install({
        key: 'NOT_A_TEMPLATE' as never,
        workspaceId: 'workspace-1',
        activate: false,
      }),
    ).rejects.toThrow();
  });

  it('should return the existing workflow instead of creating a second one when a workflow with the same name already exists', async () => {
    workflowRepository.findOne.mockResolvedValue({
      id: 'workflow-existing',
      name: 'New ticket triage',
      lastPublishedVersionId: 'version-existing',
    });

    const result = await service.installDefinition({
      definition: {
        name: 'New ticket triage',
        trigger: manualTrigger,
        steps: [appSuppliedStep],
      },
      workspaceId: 'workspace-1',
      activate: true,
    });

    expect(result).toEqual({
      workflowId: 'workflow-existing',
      workflowVersionId: 'version-existing',
    });
    expect(workflowRepository.insert).not.toHaveBeenCalled();
    expect(
      workflowTriggerService.activateWorkflowVersion,
    ).not.toHaveBeenCalled();
  });

  it('should fall back to the latest draft version when the existing workflow was never published', async () => {
    workflowRepository.findOne.mockResolvedValue({
      id: 'workflow-existing',
      name: 'New ticket triage',
      lastPublishedVersionId: null,
    });
    workflowVersionRepository.findOne.mockResolvedValue({
      id: 'version-draft',
    });

    const result = await service.installDefinition({
      definition: {
        name: 'New ticket triage',
        trigger: manualTrigger,
        steps: [appSuppliedStep],
      },
      workspaceId: 'workspace-1',
      activate: false,
    });

    expect(result).toEqual({
      workflowId: 'workflow-existing',
      workflowVersionId: 'version-draft',
    });
    expect(workflowRepository.insert).not.toHaveBeenCalled();
  });

  it('should store app-supplied steps with generated ids and valid true', async () => {
    await service.installDefinition({
      definition: {
        name: 'New ticket triage',
        trigger: manualTrigger,
        steps: [appSuppliedStep],
      },
      workspaceId: 'workspace-1',
      activate: false,
    });

    const [insertedVersion] = workflowVersionRepository.insert.mock.calls[0];

    expect(insertedVersion.steps[0]).toMatchObject({ valid: true });
    expect(insertedVersion.steps[0].id).toEqual(expect.any(String));
    expect(insertedVersion.steps[0].nextStepIds).toEqual([]);
  });

  it('should return the workflow and version ids it created', async () => {
    const result = await service.installDefinition({
      definition: {
        name: 'New ticket triage',
        trigger: manualTrigger,
        steps: [appSuppliedStep],
      },
      workspaceId: 'workspace-1',
      activate: false,
    });

    const [insertedWorkflow] = workflowRepository.insert.mock.calls[0];
    const [insertedVersion] = workflowVersionRepository.insert.mock.calls[0];

    expect(result).toEqual({
      workflowId: insertedWorkflow.id,
      workflowVersionId: insertedVersion.id,
    });
  });
});
