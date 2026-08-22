import { type StoredOAuthConnectionProviderConfig } from 'searm-shared/application';
import { isDefined } from 'searm-shared/utils';

import { ConnectionProviderEntity } from 'src/engine/core-modules/application/connection-provider/connection-provider.entity';
import { ConnectionProviderExceptionCode } from 'src/engine/core-modules/application/connection-provider/connection-provider-exception-code.enum';
import { ConnectionProviderException } from 'src/engine/core-modules/application/connection-provider/connection-provider.exception';

export type OAuthConnectionProvider = ConnectionProviderEntity & {
  type: 'oauth';
  oauthConfig: StoredOAuthConnectionProviderConfig;
};

export function assertOAuthProvider(
  provider: ConnectionProviderEntity,
): asserts provider is OAuthConnectionProvider {
  if (provider.type !== 'oauth' || !isDefined(provider.oauthConfig)) {
    throw new ConnectionProviderException(
      `Connection provider "${provider.name}" (id ${provider.id}) is not OAuth-typed or has no oauthConfig`,
      ConnectionProviderExceptionCode.INVALID_REQUEST,
    );
  }
}
