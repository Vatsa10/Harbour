export enum SSOExceptionCode {
  IDENTITY_PROVIDER_NOT_FOUND = 'IDENTITY_PROVIDER_NOT_FOUND',
  INVALID_SAML_RESPONSE = 'INVALID_SAML_RESPONSE',
  INVALID_OIDC_RESPONSE = 'INVALID_OIDC_RESPONSE',
  ASSERTION_REPLAYED = 'ASSERTION_REPLAYED',
  INVALID_STATE = 'INVALID_STATE',
  INVALID_CERTIFICATE = 'INVALID_CERTIFICATE',
  FORBIDDEN = 'FORBIDDEN',
}

// Deliberately generic public-facing messages: getAuthorizationUrlForSSO and
// the assertion-consumer callbacks are reachable without authentication, so
// exception messages must never reveal whether a given identity-provider id
// exists, is active, or why a specific assertion was rejected.
export class SSOException extends Error {
  code: SSOExceptionCode;
  userFriendlyMessage?: string;

  constructor(
    message: string,
    code: SSOExceptionCode,
    options?: { userFriendlyMessage?: string },
  ) {
    super(message);
    this.name = 'SSOException';
    this.code = code;
    this.userFriendlyMessage = options?.userFriendlyMessage;
  }
}
