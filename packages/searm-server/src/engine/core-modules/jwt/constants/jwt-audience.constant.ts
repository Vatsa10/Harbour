import { JwtTokenTypeEnum } from 'src/engine/core-modules/auth/types/jwt-token-type.enum';

// Every token type gets its own fixed audience string so a token minted for
// one purpose (e.g. REFRESH) is cryptographically rejected when verified
// against a different expected purpose (e.g. ACCESS) — this is what stops
// audience confusion, not the caller-side `payload.type` checks alone.
export const JWT_AUDIENCE_BY_TOKEN_TYPE: Record<JwtTokenTypeEnum, string> = {
  [JwtTokenTypeEnum.ACCESS]: 'urn:searm:jwt-audience:access',
  [JwtTokenTypeEnum.REFRESH]: 'urn:searm:jwt-audience:refresh',
  [JwtTokenTypeEnum.WORKSPACE_AGNOSTIC]:
    'urn:searm:jwt-audience:workspace-agnostic',
  [JwtTokenTypeEnum.LOGIN]: 'urn:searm:jwt-audience:login',
  [JwtTokenTypeEnum.FILE]: 'urn:searm:jwt-audience:file',
  [JwtTokenTypeEnum.FILE_UPLOAD]: 'urn:searm:jwt-audience:file-upload',
  [JwtTokenTypeEnum.API_KEY]: 'urn:searm:jwt-audience:api-key',
  [JwtTokenTypeEnum.REMOTE_SERVER]: 'urn:searm:jwt-audience:remote-server',
  [JwtTokenTypeEnum.KEY_ENCRYPTION_KEY]:
    'urn:searm:jwt-audience:key-encryption-key',
  [JwtTokenTypeEnum.APPLICATION_ACCESS]:
    'urn:searm:jwt-audience:application-access',
  [JwtTokenTypeEnum.APPLICATION_REFRESH]:
    'urn:searm:jwt-audience:application-refresh',
  [JwtTokenTypeEnum.APP_OAUTH_STATE]: 'urn:searm:jwt-audience:app-oauth-state',
  [JwtTokenTypeEnum.APPLICATION_REGISTRATION_GITHUB_CLAIM_STATE]:
    'urn:searm:jwt-audience:application-registration-github-claim-state',
  [JwtTokenTypeEnum.APPROVED_ACCESS_DOMAIN]:
    'urn:searm:jwt-audience:approved-access-domain',
  [JwtTokenTypeEnum.PLAYGROUND]: 'urn:searm:jwt-audience:playground',
};

export const getJwtAudienceForType = (type: JwtTokenTypeEnum): string => {
  const audience = JWT_AUDIENCE_BY_TOKEN_TYPE[type];

  if (!audience) {
    throw new Error(`No JWT audience configured for token type: ${type}`);
  }

  return audience;
};
