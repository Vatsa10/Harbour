import { CoreApiClient } from 'searm-client-sdk/core';
import { MetadataApiClient } from 'searm-client-sdk/metadata';
import { appBuild, appDeploy, appInstall, appUninstall } from 'searm-sdk/cli';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SUPPORT_TRIAGE_AGENT_NAME } from 'src/constants/agent-names';
import { APPLICATION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

// ---------------------------------------------------------------------------
// Opt-in: requires a live SeaRM instance and credentials. vitest.config.ts's
// `include` is 'src/**/*.test.ts', which does NOT match '*.integration-test.ts'
// — so `yarn test` stays server-free and this file is run explicitly:
//
//   SEARM_API_URL=... SEARM_API_KEY=... \
//     npx vitest run src/__tests__/app-install.integration-test.ts
//
// Structure copied from packages/searm-apps/examples/hello-world/src/
// __tests__/app-install.integration-test.ts (read in full).
//
// Query shapes here are verified against server code, not against the plan:
//   - Record queries on the core schema are relay connections —
//     `{ edges { node { ... } } }` — verified in
//     packages/searm-apps/internal/self-hosting/src/logic-functions/
//     match-telemetry-event-with-people.ts, which is shipped app code hitting
//     the same endpoint. The plan's flat `companies { id }` shape is wrong.
//   - `findManyApplications` / `findManyAgents` are metadata-schema resolvers
//     returning plain lists (application.dto.ts, agent.dto.ts).
//   - `findManyAgents` takes no filter argument and AgentDTO exposes no
//     universalIdentifier, so the agent is matched by name — the same
//     constraint documented in src/utils/find-agent-id-by-name.util.ts.
//   - `roleId` is a real nullable field on AgentDTO (agent.dto.ts:...roleId).
//   - `workflows` is the standard WorkflowWorkspaceEntity, whose `statuses`
//     field is a WorkflowStatus[] (workflow.workspace-entity.ts:21).
// ---------------------------------------------------------------------------

const APP_PATH = process.cwd();

const TEST_COMPANY_NAME = 'Acme Corp (customer-support install test)';

describe('Customer Support app installation', () => {
  beforeAll(async () => {
    const buildResult = await appBuild({ appPath: APP_PATH, tarball: true });

    if (!buildResult.success) {
      throw new Error(
        `Build failed: ${buildResult.error?.message ?? 'Unknown error'}`,
      );
    }

    const deployResult = await appDeploy({
      tarballPath: buildResult.data.tarballPath!,
    });

    if (!deployResult.success) {
      throw new Error(
        `Deploy failed: ${deployResult.error?.message ?? 'Unknown error'}`,
      );
    }

    const installResult = await appInstall({ appPath: APP_PATH });

    if (!installResult.success) {
      throw new Error(
        `Install failed: ${installResult.error?.message ?? 'Unknown error'}`,
      );
    }
  });

  afterAll(async () => {
    // The uninstall assertion below already uninstalls; this is the safety net
    // for a run that failed before reaching it. Uninstalling twice is not an
    // error worth failing the suite over, hence warn-only.
    const uninstallResult = await appUninstall({ appPath: APP_PATH });

    if (!uninstallResult.success) {
      console.warn(
        `Uninstall cleanup failed: ${uninstallResult.error?.message ?? 'Unknown error'}`,
      );
    }
  });

  it('should find the installed app', async () => {
    const metadataClient = new MetadataApiClient();

    const { findManyApplications } = await metadataClient.query({
      findManyApplications: {
        id: true,
        name: true,
        universalIdentifier: true,
      },
    });

    const installed = findManyApplications.find(
      (application: { universalIdentifier: string }) =>
        application.universalIdentifier === APPLICATION_UNIVERSAL_IDENTIFIER,
    );

    expect(installed).toBeDefined();
  });

  it('should seed exactly one default queue on fresh install', async () => {
    const coreClient = new CoreApiClient();

    const { supportQueues } = await coreClient.query({
      supportQueues: {
        __args: { filter: { isDefault: { eq: true } } },
        edges: { node: { id: true, name: true, isDefault: true } },
      },
    });

    expect(supportQueues.edges).toHaveLength(1);
    expect(supportQueues.edges[0].node.name).toBe('General Support');
  });

  it('should let a support ticket be created and related to a company', async () => {
    const coreClient = new CoreApiClient();

    const { createCompany } = await coreClient.mutation({
      createCompany: {
        __args: { data: { name: TEST_COMPANY_NAME } },
        id: true,
      },
    });

    const { createSupportTicket } = await coreClient.mutation({
      createSupportTicket: {
        __args: {
          data: {
            subject: 'Cannot export report',
            description: 'Export button does nothing.',
            companyId: createCompany.id,
          },
        },
        id: true,
        subject: true,
        status: true,
      },
    });

    // Default declared on src/objects/support-ticket.object.ts's status field.
    expect(createSupportTicket.status).toBe('NEW');

    const { supportTickets } = await coreClient.query({
      supportTickets: {
        __args: { filter: { id: { eq: createSupportTicket.id } } },
        edges: { node: { id: true, company: { id: true, name: true } } },
      },
    });

    expect(supportTickets.edges).toHaveLength(1);
    expect(supportTickets.edges[0].node.company.name).toBe(TEST_COMPANY_NAME);
  });

  it('should install both workflow templates as ACTIVE', async () => {
    // Proves post-install's two installWorkflowDefinition calls landed. The
    // failure mode this catches: the app's service role missing the WORKFLOWS
    // permission flag (workflow-definition-install.resolver.ts is guarded by
    // SettingsPermissionGuard(PermissionFlagType.WORKFLOWS)) — both workflows
    // would silently never install, and this is the first place it shows.
    const coreClient = new CoreApiClient();

    const { workflows } = await coreClient.query({
      workflows: {
        __args: {
          filter: { name: { in: ['New ticket triage', 'SLA risk sweep'] } },
        },
        edges: { node: { name: true, statuses: true } },
      },
    });

    expect(workflows.edges).toHaveLength(2);

    for (const edge of workflows.edges) {
      expect(edge.node.statuses).toContain('ACTIVE');
    }
  });

  it('should give the support triage agent a usable role after install', async () => {
    // Open risk this closes empirically: whether canBeAssignedToAgents on the
    // support-agent role is sufficient for the install-time role-target row to
    // be written. If it is not, the agent installs with no role and silently
    // loses every registry tool. roleId being null is exactly that failure.
    const metadataClient = new MetadataApiClient();

    const { findManyAgents } = await metadataClient.query({
      findManyAgents: { id: true, name: true, roleId: true },
    });

    const triageAgents = findManyAgents.filter(
      (agent: { name: string }) => agent.name === SUPPORT_TRIAGE_AGENT_NAME,
    );

    expect(triageAgents).toHaveLength(1);
    expect(triageAgents[0].roleId).toBeTruthy();
  });

  it('should remove the ticket object on uninstall and leave Company untouched', async () => {
    const uninstallResult = await appUninstall({ appPath: APP_PATH });

    expect(uninstallResult.success).toBe(true);

    const metadataClient = new MetadataApiClient();

    // `objects`, a relay connection — NOT the plan's
    // `findManyObjectMetadataItems`, which does not exist anywhere in
    // searm-server. Verified against packages/searm-server/test/integration/
    // graphql/suites/event-logs/object-event-write.integration-spec.ts:40,
    // which queries `objects(paging: { first: 1000 }) { edges { node { ... } } }`
    // on the metadata API.
    const { objects } = await metadataClient.query({
      objects: {
        __args: { paging: { first: 1000 }, filter: {} },
        edges: { node: { nameSingular: true } },
      },
    });

    const stillHasTicketObject = objects.edges.some(
      (edge: { node: { nameSingular: string } }) =>
        edge.node.nameSingular === 'supportTicket',
    );

    expect(stillHasTicketObject).toBe(false);

    // The core CRM must be undamaged: the Company created above is a standard
    // object record, not app-owned, and uninstall must not touch it.
    const coreClient = new CoreApiClient();

    const { companies } = await coreClient.query({
      companies: {
        __args: { filter: { name: { eq: TEST_COMPANY_NAME } } },
        edges: { node: { id: true } },
      },
    });

    expect(companies.edges).toHaveLength(1);
  });
});
