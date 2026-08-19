import {
  IdentityProviderType,
  SSOIdentityProviderStatus,
} from 'src/engine/core-modules/sso/workspace-sso-identity-provider.entity';

export type SAMLSSOConfiguration = {
  id: string;
  workspaceId: string;
  type: IdentityProviderType.SAML;
  name: string;
  status: SSOIdentityProviderStatus;
  issuer: string;
  ssoUrl: string;
  certificate: string;
};

export type OIDCSSOConfiguration = {
  id: string;
  workspaceId: string;
  type: IdentityProviderType.OIDC;
  name: string;
  status: SSOIdentityProviderStatus;
  issuer: string;
  clientID: string;
  clientSecret: string;
};

export type SSOConfiguration = SAMLSSOConfiguration | OIDCSSOConfiguration;
