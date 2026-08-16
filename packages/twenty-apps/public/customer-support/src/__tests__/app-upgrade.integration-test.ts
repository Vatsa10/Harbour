import { CoreApiClient } from 'twenty-client-sdk/core';
import { MetadataApiClient } from 'twenty-client-sdk/metadata';
import { appBuild, appDeploy, appInstall, appUninstall } from 'twenty-sdk/cli';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { APPLICATION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

import packageJson from '../../package.json';

// ---------------------------------------------------------------------------
// Opt-in, same as app-install.integration-test.ts — requires a live instance:
//
//   TWENTY_API_URL=... TWENTY_API_KEY=... \
//     npx vitest run src/__tests__/app-upgrade.integration-test.ts
//
// Scope, stated honestly: this proves the two upgrade properties that can be
// checked without checking out two manifest states mid-run —
//   1. the installed version the server reports matches package.json, and
//   2. re-installing over an existing install (the same code path an upgrade
//      takes: post-install runs again) does NOT duplicate seeded data.
//
// (2) is the real regression guard. post-install's queue seed is guarded on
// payload.previousVersion, and installWorkflowDefinition is idempotent by
// workflow name server-side; both claims are only claims until a second
// install run leaves the counts unchanged.
//
// A full schema-migration rehearsal — bump package.json's version, add a field
// to support-ticket.object.ts, rebuild, redeploy, upgrade, confirm the new
// field exists and existing ticket rows survived — is a manual step documented
// in the task brief, not automated here.
// ---------------------------------------------------------------------------

const APP_PATH = process.cwd();

const buildDeployInstall = async () => {
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
};

describe('Customer Support app upgrade', () => {
  beforeAll(async () => {
    await buildDeployInstall();
  });

  afterAll(async () => {
    const uninstallResult = await appUninstall({ appPath: APP_PATH });

    if (!uninstallResult.success) {
      console.warn(
        `Uninstall cleanup failed: ${uninstallResult.error?.message ?? 'Unknown error'}`,
      );
    }
  });

  it('should report the installed version matching package.json', async () => {
    // Read from package.json rather than hardcoded, so a version bump does not
    // require editing this test. `version` is a real nullable field on
    // ApplicationDTO (application.dto.ts).
    const metadataClient = new MetadataApiClient();

    const { findManyApplications } = await metadataClient.query({
      findManyApplications: {
        name: true,
        version: true,
        universalIdentifier: true,
      },
    });

    const installed = findManyApplications.find(
      (application: { universalIdentifier: string }) =>
        application.universalIdentifier === APPLICATION_UNIVERSAL_IDENTIFIER,
    );

    expect(installed).toBeDefined();
    expect(installed?.version).toBe(packageJson.version);
  });

  it('should not duplicate seeded data when post-install runs a second time', async () => {
    const coreClient = new CoreApiClient();

    const countDefaultQueues = async () => {
      const { supportQueues } = await coreClient.query({
        supportQueues: {
          __args: { filter: { isDefault: { eq: true } } },
          edges: { node: { id: true } },
        },
      });

      return supportQueues.edges.length;
    };

    const countSeededWorkflows = async () => {
      const { workflows } = await coreClient.query({
        workflows: {
          __args: {
            filter: { name: { in: ['New ticket triage', 'SLA risk sweep'] } },
          },
          edges: { node: { id: true } },
        },
      });

      return workflows.edges.length;
    };

    expect(await countDefaultQueues()).toBe(1);
    expect(await countSeededWorkflows()).toBe(2);

    // Re-install over the existing install: post-install runs again, exactly
    // as it does on an upgrade.
    await buildDeployInstall();

    expect(await countDefaultQueues()).toBe(1);
    expect(await countSeededWorkflows()).toBe(2);
  });
});
