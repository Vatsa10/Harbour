/* @license Enterprise */

import { Injectable } from '@nestjs/common';

import {
  EmailGroupAccessException,
  EmailGroupAccessExceptionCode,
} from 'src/engine/core-modules/emailing-domain/exceptions/email-group-access.exception';
import { EnterprisePlanService } from 'src/engine/core-modules/enterprise/services/enterprise-plan.service';

// Self-hosted instances gate email group behind a valid Enterprise plan.
@Injectable()
export class EmailGroupAccessService {
  constructor(private readonly enterprisePlanService: EnterprisePlanService) {}

  validateEmailGroupAccessOrThrow(): void {
    if (!this.enterprisePlanService.isValid()) {
      throw new EmailGroupAccessException(
        'Email group requires an Enterprise plan',
        EmailGroupAccessExceptionCode.EMAIL_GROUP_ENTERPRISE_PLAN_REQUIRED,
      );
    }
  }
}
