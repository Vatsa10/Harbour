import { type CanActivate, Injectable } from '@nestjs/common';

// Self-hosted AGPL builds have no license-gated feature tier: every route
// guarded by this class (SSO, event logs, etc.) is always allowed through.
@Injectable()
export class EnterpriseFeaturesEnabledGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}
