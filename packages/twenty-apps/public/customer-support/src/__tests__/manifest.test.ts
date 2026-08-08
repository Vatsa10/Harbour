import { describe, expect, it } from 'vitest';

import { SystemPermissionFlag } from 'twenty-sdk/define';

import supportTriageAgent from 'src/agents/support-triage-agent';
import applicationConfig from 'src/application-config';
import {
  SUPPORT_AGENT_ROLE_UNIVERSAL_IDENTIFIER,
  SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  TICKET_AI_TRIAGE_SUMMARY_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_STATUS_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';
import appDefaultRole from 'src/roles/app-default.role';
import supportAgentRole from 'src/roles/support-agent.role';

// These tests read the definitions the way the CLI's manifest builder does —
// the default export of every src file is a ValidationResult from a define*()
// call — and cross-check them against each other. They do not touch a server;
// what they prove is that the manifest is internally coherent and that the two
// roles grant exactly what is intended and nothing more.

type ValidationResultLike = {
  success: boolean;
  errors: string[];
  config: Record<string, unknown>;
};

const isValidationResultLike = (
  value: unknown,
): value is ValidationResultLike =>
  typeof value === 'object' &&
  value !== null &&
  'success' in value &&
  'config' in value &&
  Array.isArray((value as { errors?: unknown }).errors);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Every definition file in the app, discovered rather than listed, so a new
// file cannot quietly escape these checks.
const definitionModules = import.meta.glob<{ default: unknown }>(
  [
    '../**/*.ts',
    '!../constants/**',
    '!../__tests__/**',
    '!../logic-functions/**',
    // Plain modules, not manifest units. A workflow template is installed at
    // runtime through installWorkflowDefinition (there is no workflow
    // manifest unit type), so these files export functions, not define*()
    // results — same category as constants and logic-function handlers.
    '!../utils/**',
    '!../workflow-templates/**',
  ],
  { eager: true },
);

const definitions = Object.entries(definitionModules).map(([path, module]) => {
  if (!isValidationResultLike(module.default)) {
    throw new Error(`${path} does not default-export a define*() result`);
  }

  return { path, result: module.default };
});

const configsWhere = (
  predicate: (config: Record<string, unknown>) => boolean,
): Record<string, unknown>[] =>
  definitions.map(({ result }) => result.config).filter(predicate);

const isRelationField = (config: Record<string, unknown>): boolean =>
  config.type === 'RELATION' &&
  typeof config.relationTargetFieldMetadataUniversalIdentifier === 'string';

const objectConfigs = configsWhere(
  (config) => Array.isArray(config.fields) && typeof config.nameSingular === 'string',
);
const relationFieldConfigs = configsWhere(isRelationField);

describe('every definition', () => {
  it('validates without errors', () => {
    const failures = definitions
      .filter(({ result }) => !result.success || result.errors.length > 0)
      .map(({ path, result }) => `${path}: ${result.errors.join(', ')}`);

    expect(failures).toEqual([]);
  });

  it('carries a well-formed universalIdentifier', () => {
    const bad = definitions
      .filter(
        ({ result }) =>
          typeof result.config.universalIdentifier !== 'string' ||
          !UUID_PATTERN.test(result.config.universalIdentifier as string),
      )
      .map(({ path }) => path);

    expect(bad).toEqual([]);
  });

  it('uses a universalIdentifier at most once', () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];

    for (const { path, result } of definitions) {
      const id = result.config.universalIdentifier as string;
      const previous = seen.get(id);

      if (previous !== undefined) {
        duplicates.push(`${id}: ${previous} and ${path}`);
      }
      seen.set(id, path);
    }

    expect(duplicates).toEqual([]);
  });
});

describe('objects and fields', () => {
  it('declares both app objects', () => {
    expect(
      objectConfigs.map((config) => config.universalIdentifier).sort(),
    ).toEqual(
      [
        SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
        SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
      ].sort(),
    );
  });

  it('gives every inline field a unique identifier and a type', () => {
    const problems: string[] = [];
    const seen = new Set<string>();

    for (const object of objectConfigs) {
      for (const field of object.fields as Record<string, unknown>[]) {
        if (typeof field.type !== 'string') {
          problems.push(`${String(field.name)} has no type`);
        }
        const id = field.universalIdentifier as string;

        if (!UUID_PATTERN.test(id)) {
          problems.push(`${String(field.name)} has a malformed identifier`);
        }
        if (seen.has(id)) {
          problems.push(`${String(field.name)} reuses identifier ${id}`);
        }
        seen.add(id);
      }
    }

    expect(problems).toEqual([]);
  });
});

describe('relations', () => {
  it('points every relation field at an object the app or the standard schema owns', () => {
    const appObjectIds = new Set(
      objectConfigs.map((config) => config.universalIdentifier as string),
    );

    const problems = relationFieldConfigs
      .filter((config) => {
        const target =
          config.relationTargetObjectMetadataUniversalIdentifier as string;

        // Targets outside the app are standard objects (company, person,
        // workspaceMember); they must still be real UUIDs, and at least one
        // side of every pair must live in this app.
        return (
          !UUID_PATTERN.test(target) ||
          (!appObjectIds.has(target) &&
            !appObjectIds.has(config.objectUniversalIdentifier as string))
        );
      })
      .map((config) => String(config.name));

    expect(problems).toEqual([]);
  });

  it('pairs every relation field with a counterpart that points back at it', () => {
    const byId = new Map(
      relationFieldConfigs.map((config) => [
        config.universalIdentifier as string,
        config,
      ]),
    );

    const problems: string[] = [];

    for (const config of relationFieldConfigs) {
      const targetId =
        config.relationTargetFieldMetadataUniversalIdentifier as string;
      const counterpart = byId.get(targetId);

      if (counterpart === undefined) {
        problems.push(`${String(config.name)} targets missing field ${targetId}`);
        continue;
      }

      if (
        counterpart.relationTargetFieldMetadataUniversalIdentifier !==
        config.universalIdentifier
      ) {
        problems.push(`${String(config.name)} is not pointed back at`);
      }

      if (
        counterpart.objectUniversalIdentifier !==
        config.relationTargetObjectMetadataUniversalIdentifier
      ) {
        problems.push(
          `${String(config.name)} target object disagrees with its counterpart`,
        );
      }
    }

    expect(problems).toEqual([]);
  });

  it('gives every MANY_TO_ONE side a joinColumnName and an onDelete', () => {
    const problems = relationFieldConfigs
      .filter((config) => {
        const settings = config.universalSettings as
          | Record<string, unknown>
          | undefined;

        return (
          settings?.relationType === 'MANY_TO_ONE' &&
          (typeof settings.joinColumnName !== 'string' ||
            typeof settings.onDelete !== 'string')
        );
      })
      .map((config) => String(config.name));

    expect(problems).toEqual([]);
  });
});

describe('the application service role', () => {
  const config = appDefaultRole.config as Record<string, unknown>;

  // Every grant here is a standing permission on every workspace that
  // installs the app, so each one must be backed by a call this app's own
  // code makes. This test is what stops the next hello-world copy-paste: it
  // enumerates the grants exactly, so an unbacked addition fails.
  it('grants nothing beyond what its own logic functions call', () => {
    expect(config.canReadAllObjectRecords).toBe(false);
    expect(config.canUpdateAllObjectRecords).toBe(false);
    expect(config.canSoftDeleteAllObjectRecords).toBe(false);
    expect(config.canDestroyAllObjectRecords).toBe(false);
    expect(config.canUpdateAllSettings).toBe(false);
    // supportQueue only — post-install's createSupportQueue. Creation is
    // gated by the same bit as update; there is no separate create flag.
    expect(config.objectPermissions).toEqual([
      {
        objectUniversalIdentifier: SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
        canReadObjectRecords: true,
        canUpdateObjectRecords: true,
        canSoftDeleteObjectRecords: false,
        canDestroyObjectRecords: false,
      },
    ]);
    expect(config.fieldPermissions).toEqual([]);
    // WORKFLOWS backs installWorkflowDefinition; AI backs findManyAgents.
    expect(config.permissionFlagUniversalIdentifiers).toEqual([
      SystemPermissionFlag.WORKFLOWS,
      SystemPermissionFlag.AI,
    ]);
  });

  it('is not assignable to a human or an agent', () => {
    expect(config.canBeAssignedToUsers).toBe(false);
    expect(config.canBeAssignedToAgents).toBe(false);
    expect(config.canBeAssignedToApiKeys).toBe(false);
  });
});

describe('the support agent role', () => {
  const config = supportAgentRole.config as Record<string, unknown>;
  const objectPermissions = config.objectPermissions as Record<
    string,
    unknown
  >[];
  const fieldPermissions = config.fieldPermissions as Record<
    string,
    unknown
  >[];

  it('holds no workspace-wide grant and no settings flag', () => {
    expect(config.canReadAllObjectRecords).toBe(false);
    expect(config.canUpdateAllObjectRecords).toBe(false);
    expect(config.canSoftDeleteAllObjectRecords).toBe(false);
    expect(config.canDestroyAllObjectRecords).toBe(false);
    expect(config.canUpdateAllSettings).toBe(false);
    expect(config.permissionFlagUniversalIdentifiers ?? []).toEqual([]);
  });

  it('is bindable to an agent and to nothing else', () => {
    expect(config.canBeAssignedToAgents).toBe(true);
    expect(config.canBeAssignedToUsers).toBe(false);
    expect(config.canBeAssignedToApiKeys).toBe(false);
  });

  it('can write records on the ticket object only', () => {
    const writable = objectPermissions
      .filter((permission) => permission.canUpdateObjectRecords === true)
      .map((permission) => permission.objectUniversalIdentifier);

    expect(writable).toEqual([SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER]);
  });

  it('can never delete anything', () => {
    for (const permission of objectPermissions) {
      expect(permission.canSoftDeleteObjectRecords).toBe(false);
      expect(permission.canDestroyObjectRecords).toBe(false);
    }
  });

  // The core guarantee: the skill says "never close a ticket". This asserts it
  // at the permission layer rather than in the prompt.
  it('may write exactly status, priority and aiTriageSummary on a ticket', () => {
    const ticket = objectConfigs.find(
      (object) =>
        object.universalIdentifier === SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
    );

    const allTicketFieldIds = (
      ticket?.fields as Record<string, unknown>[]
    ).map((field) => field.universalIdentifier as string);

    const deniedIds = new Set(
      fieldPermissions
        .filter((permission) => permission.canUpdateFieldValue === false)
        .map((permission) => permission.fieldUniversalIdentifier as string),
    );

    const writableInlineFields = allTicketFieldIds.filter(
      (id) => !deniedIds.has(id),
    );

    expect(writableInlineFields.sort()).toEqual(
      [
        TICKET_STATUS_FIELD_UNIVERSAL_IDENTIFIER,
        TICKET_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER,
        TICKET_AI_TRIAGE_SUMMARY_FIELD_UNIVERSAL_IDENTIFIER,
      ].sort(),
    );
  });

  it('denies writes to every relation field on the ticket', () => {
    const ticketRelationIds = relationFieldConfigs
      .filter(
        (config_) =>
          config_.objectUniversalIdentifier ===
          SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
      )
      .map((config_) => config_.universalIdentifier as string);

    const deniedIds = new Set(
      fieldPermissions
        .filter((permission) => permission.canUpdateFieldValue === false)
        .map((permission) => permission.fieldUniversalIdentifier as string),
    );

    expect(ticketRelationIds.length).toBeGreaterThan(0);
    for (const id of ticketRelationIds) {
      expect(deniedIds.has(id)).toBe(true);
    }
  });

  it('leaves reads unrestricted', () => {
    for (const permission of fieldPermissions) {
      expect(permission.canReadFieldValue).toBeUndefined();
    }
  });

  it('scopes every field permission to the ticket object', () => {
    for (const permission of fieldPermissions) {
      expect(permission.objectUniversalIdentifier).toBe(
        SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
      );
    }
  });
});

describe('the triage agent', () => {
  const config = supportTriageAgent.config as Record<string, unknown>;

  // Without this the manifest converter never creates the role-target row and
  // the agent installs with no tools whatsoever.
  it('carries the support agent role', () => {
    expect(config.roleUniversalIdentifier).toBe(
      SUPPORT_AGENT_ROLE_UNIVERSAL_IDENTIFIER,
    );
  });
});

describe('the application', () => {
  it('does not use the deprecated defaultRoleUniversalIdentifier', () => {
    expect(
      (applicationConfig.config as Record<string, unknown>)
        .defaultRoleUniversalIdentifier,
    ).toBeUndefined();
  });

  it('declares a known application category', () => {
    expect([
      'Communication',
      'Productivity',
      'Product management',
      'Sales',
      'Marketing',
      'Enrichment',
      'Data',
      'Search',
      'Other',
    ]).toContain((applicationConfig.config as Record<string, unknown>).category);
  });
});
