import { readFileSync } from 'fs';
import { join } from 'path';

// The approval inbox route and the ProposalResolver it talks to are guarded
// independently — one in searm-front, one in searm-server — with no shared
// constant to keep them in sync. They drifted once already (route required
// AI_SETTINGS while the resolver required only AI), which locked reviewers
// entitled to approve proposals out of the page that lets them do it. This
// test reads both source files and asserts the flags still match, so a
// future edit to either side fails fast instead of shipping a silent lockout.

const FRONT_ROUTES_PATH = join(
  __dirname,
  '../SettingsRoutes.tsx',
);

const SERVER_RESOLVER_PATH = join(
  __dirname,
  '../../../../../../searm-server/src/engine/metadata-modules/ai/ai-write-approval/resolvers/proposal.resolver.ts',
);

describe('approval inbox route guard stays aligned with the server resolver guard', () => {
  it('guards SettingsPath.AiApprovals with the same PermissionFlagType the server resolver requires', () => {
    const frontSource = readFileSync(FRONT_ROUTES_PATH, 'utf-8');
    const serverSource = readFileSync(SERVER_RESOLVER_PATH, 'utf-8');

    // Isolate the <Route> block for AiApprovals and the wrapper guarding it.
    const aiApprovalsRouteIndex = frontSource.indexOf(
      'path={SettingsPath.AiApprovals}',
    );
    expect(aiApprovalsRouteIndex).toBeGreaterThan(-1);

    // Walk backward to the nearest enclosing SettingsProtectedRouteWrapper's
    // settingsPermission prop, which is what actually gates the page.
    const precedingSource = frontSource.slice(0, aiApprovalsRouteIndex);
    const wrapperMatches = [
      ...precedingSource.matchAll(
        /settingsPermission={PermissionFlagType\.([A-Z_]+)}/g,
      ),
    ];
    expect(wrapperMatches.length).toBeGreaterThan(0);
    const frontPermissionFlag =
      wrapperMatches[wrapperMatches.length - 1][1];

    const serverGuardMatch = serverSource.match(
      /SettingsPermissionGuard\(PermissionFlagType\.([A-Z_]+)\)/,
    );
    expect(serverGuardMatch).not.toBeNull();
    const serverPermissionFlag = serverGuardMatch?.[1];

    expect(frontPermissionFlag).toBe(serverPermissionFlag);
  });
});
