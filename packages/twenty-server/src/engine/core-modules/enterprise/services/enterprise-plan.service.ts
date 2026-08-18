import { Injectable } from '@nestjs/common';

// Twenty is distributed under the AGPLv3. There is no separate "enterprise"
// tier in a self-hosted deployment, so every gate this service used to drive
// (event logs, JWT signing-key rotation, SSO, emailing-domain group access,
// workspace-count limits, ...) is simply always on.
@Injectable()
export class EnterprisePlanService {
  isValid(): boolean {
    return true;
  }

  hasValidSignedEnterpriseKey(): boolean {
    return true;
  }

  hasValidEnterpriseValidityToken(): boolean {
    return true;
  }
}
