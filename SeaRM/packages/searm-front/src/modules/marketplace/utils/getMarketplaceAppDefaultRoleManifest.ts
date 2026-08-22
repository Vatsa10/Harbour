import { buildRoleManifestFromMarketplaceAppRole } from '@/marketplace/utils/buildRoleManifestFromMarketplaceAppRole';
import { type RoleManifest } from 'searm-shared/application';
import { isDefined } from 'searm-shared/utils';
import { type MarketplaceAppDetail } from '~/generated-metadata/graphql';

export const getMarketplaceAppDefaultRoleManifest = (
  detail:
    | Pick<MarketplaceAppDetail, 'roles' | 'defaultRoleUniversalIdentifier'>
    | null
    | undefined,
): RoleManifest | undefined => {
  const defaultRole = detail?.roles?.find(
    (role) =>
      role.universalIdentifier === detail?.defaultRoleUniversalIdentifier,
  );

  return isDefined(defaultRole)
    ? buildRoleManifestFromMarketplaceAppRole(defaultRole)
    : undefined;
};
