import { type CoreApiClient } from 'twenty-client-sdk/core';

// ---------------------------------------------------------------------------
// THE COPY-PASTE ARTIFACT.
//
// This file is the whole of "an app installs its workflows". Copy it
// unmodified into the next vertical app; only the WorkflowTemplate data
// objects change. It contains no customer-support concept, no object name and
// no identifier — everything it needs arrives as an argument.
//
// It is a thin wrapper over the core-schema mutation
// `installWorkflowDefinition`, which Phase 4 Task 10 exposes over
// WorkflowTemplateService.installDefinition. Everything hard — creating the
// workflow row, positioning it, creating the draft version, normalising and
// chaining steps, activating the trigger, and idempotency-by-name — lives
// server-side and is unit-tested there. Verified against:
//   packages/twenty-server/src/modules/workflow/workflow-templates/
//     resolvers/workflow-definition-install.resolver.ts   (@CoreResolver)
//     dtos/install-workflow-definition.input.ts
//     dtos/workflow-template.dto.ts  (InstalledWorkflowTemplate)
//     services/workflow-template.service.ts (installDefinition)
// ---------------------------------------------------------------------------

// Mirrors the server's WorkflowTrigger union
// (packages/twenty-server/src/modules/workflow/workflow-trigger/types/
// workflow-trigger.type.ts). That union is not exported from any published
// package, and the GraphQL argument is typed as JSON server-side
// (`@Field(() => GraphQLJSON) trigger: Record<string, unknown>`), so a
// structurally correct plain object is the contract. `name` is required by
// the server's BaseTrigger and is filled in by seedWorkflow below, so a
// template does not have to repeat its own name.
export type WorkflowTriggerTemplate =
  | {
      type: 'DATABASE_EVENT';
      // `<objectNameSingular>.<action>`, e.g. 'supportTicket.created' —
      // split on '.' by workflow-schema.workspace-service.ts:303.
      settings: { eventName: string; outputSchema: Record<string, never> };
    }
  | {
      type: 'CRON';
      settings: {
        outputSchema: Record<string, never>;
        type: 'MINUTES';
        schedule: { minute: number };
      };
    }
  | {
      type: 'MANUAL';
      settings: { outputSchema: Record<string, never> };
    };

export type WorkflowStepTemplate = {
  // InstallWorkflowDefinitionInput requires only { type, name, settings }:
  // normalizeWorkflowTemplateSteps (server-side) fills in `id` (uuidv4),
  // `valid` (true) and `nextStepIds` (chained in array order, last step
  // terminating at []). It preserves anything authored explicitly, so passing
  // a fixed id keeps this app's stable-identity convention without fighting
  // the server.
  id?: string;
  // A WorkflowActionType value. Deliberately a string, not the enum: the enum
  // lives in `twenty-shared/workflow`, and twenty-shared is not a dependency
  // an installable app can resolve (it is not published alongside twenty-sdk /
  // twenty-client-sdk). See WORKFLOW_ACTION_TYPE below.
  type: string;
  name: string;
  valid?: boolean;
  nextStepIds?: string[] | null;
  settings: Record<string, unknown>;
};

export type WorkflowTemplate = {
  name: string;
  description?: string;
  trigger: WorkflowTriggerTemplate;
  // Executed in array order; the server chains them.
  steps: WorkflowStepTemplate[];
};

// The subset of twenty-shared's WorkflowActionType an app can reach without
// depending on twenty-shared. Values are the enum's string values, verified
// against packages/twenty-shared/src/workflow/types/WorkflowActionType.ts and
// against the shipped built-in templates in
// packages/twenty-server/src/modules/workflow/workflow-templates/constants/
// workflow-templates.const.ts.
export const WORKFLOW_ACTION_TYPE = {
  AI_AGENT: 'AI_AGENT',
} as const;

// Standard no-retry / no-continue error handling, the shape every shipped
// built-in template uses.
export const DEFAULT_STEP_ERROR_HANDLING_OPTIONS = {
  retryOnFailure: { value: false },
  continueOnFailure: { value: false },
} as const;

export type InstalledWorkflow = {
  workflowId: string;
  workflowVersionId: string;
};

// One call into installWorkflowDefinition. Idempotent by workflow name
// server-side, so a post-install hook that re-runs on every app upgrade does
// not create a second copy.
export const seedWorkflow = async (
  client: CoreApiClient,
  template: WorkflowTemplate,
): Promise<InstalledWorkflow> => {
  const result = await client.mutation({
    installWorkflowDefinition: {
      __args: {
        input: {
          name: template.name,
          description: template.description ?? null,
          trigger: {
            // BaseTrigger.name is required server-side and is not part of the
            // app-facing template shape — derive it.
            name: `${template.name} trigger`,
            type: template.trigger.type,
            settings: template.trigger.settings,
          },
          steps: template.steps,
          activate: true,
        },
      },
      workflowId: true,
      workflowVersionId: true,
    },
  });

  // CoreApiClient's generated surface is untyped (`query: any; mutation: any`
  // in twenty-client-sdk/dist/core/generated/index.d.ts), so the response is
  // narrowed here rather than inferred.
  const installed = (
    result as {
      installWorkflowDefinition?: InstalledWorkflow;
    }
  ).installWorkflowDefinition;

  if (!installed?.workflowId || !installed?.workflowVersionId) {
    throw new Error(`Failed to install workflow "${template.name}".`);
  }

  return installed;
};