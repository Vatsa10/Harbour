import { readFileSync } from 'fs';
import { join } from 'path';

// Same drift hazard as the approvals route guard, same fix: the page's route
// guard and the resolver's guard are declared in two packages with no shared
// constant. If they drift, either the page loads for someone whose query
// always fails, or it hides from an administrator entitled to it.

const FRONT_ROUTES_PATH = join(__dirname, '../SettingsRoutes.tsx');

const SERVER_RESOLVER_PATH = join(
  __dirname,
  '../../../../../../twenty-server/src/engine/metadata-modules/ai/ai-trust-dashboard/resolvers/ai-trust-dashboard.resolver.ts',
);

describe('trust dashboard route guard stays aligned with the server resolver guard', () => {
  it('guards SettingsPath.AiTrustDashboard with the flag the resolver requires', () => {
    const frontSource = readFileSync(FRONT_ROUTES_PATH, 'utf-8');
    const serverSource = readFileSync(SERVER_RESOLVER_PATH, 'utf-8');

    const routeIndex = frontSource.indexOf(
      'path={SettingsPath.AiTrustDashboard}',
    );

    expect(routeIndex).toBeGreaterThan(-1);

    const wrapperMatches = [
      ...frontSource
        .slice(0, routeIndex)
        .matchAll(/settingsPermission={PermissionFlagType\.([A-Z_]+)}/g),
    ];

    expect(wrapperMatches.length).toBeGreaterThan(0);

    const frontPermissionFlag = wrapperMatches[wrapperMatches.length - 1][1];

    const serverGuardMatch = serverSource.match(
      /SettingsPermissionGuard\(PermissionFlagType\.([A-Z_]+)\)/,
    );

    expect(serverGuardMatch).not.toBeNull();

    expect(frontPermissionFlag).toBe(serverGuardMatch?.[1]);
  });

  it('hides the navigation entry behind the same flag as the route', () => {
    const frontSource = readFileSync(FRONT_ROUTES_PATH, 'utf-8');
    const navSource = readFileSync(
      join(
        __dirname,
        '../../../settings/hooks/useSettingsNavigationItems.tsx',
      ),
      'utf-8',
    );

    const routeIndex = frontSource.indexOf(
      'path={SettingsPath.AiTrustDashboard}',
    );
    const routeFlag = [
      ...frontSource
        .slice(0, routeIndex)
        .matchAll(/settingsPermission={PermissionFlagType\.([A-Z_]+)}/g),
    ].slice(-1)[0][1];

    const navIndex = navSource.indexOf('SettingsPath.AiTrustDashboard');

    expect(navIndex).toBeGreaterThan(-1);

    // The isHidden line follows the path line inside the same nav item.
    const navFlagMatch = navSource
      .slice(navIndex)
      .match(/isHidden: !permissionMap\[PermissionFlagType\.([A-Z_]+)\]/);

    expect(navFlagMatch).not.toBeNull();
    expect(navFlagMatch?.[1]).toBe(routeFlag);
  });
});
