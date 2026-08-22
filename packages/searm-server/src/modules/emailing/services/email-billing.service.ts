import { Injectable } from '@nestjs/common';

import { USAGE_RECORDED } from 'src/engine/core-modules/usage/constants/usage-recorded.constant';
import { UsageOperationType } from 'src/engine/core-modules/usage/enums/usage-operation-type.enum';
import { UsageResourceType } from 'src/engine/core-modules/usage/enums/usage-resource-type.enum';
import { UsageUnit } from 'src/engine/core-modules/usage/enums/usage-unit.enum';
import { type UsageEvent } from 'src/engine/core-modules/usage/types/usage-event.type';
import { convertDollarsToBillingCredits } from 'src/engine/metadata-modules/ai/ai-billing/utils/convert-dollars-to-billing-credits.util';
import { WorkspaceEventEmitter } from 'src/engine/workspace-event-emitter/workspace-event-emitter';
import { EMAIL_MARGIN_MULTIPLIER } from 'src/modules/emailing/constants/email-margin-multiplier';
import { SES_EMAIL_COST_PER_THOUSAND_DOLLARS } from 'src/modules/emailing/constants/ses-email-cost-per-thousand-dollars';

@Injectable()
export class EmailBillingService {
  constructor(
    private readonly workspaceEventEmitter: WorkspaceEventEmitter,
  ) {}

  // AGPL build: no paid tiers, email credits are always available.
  async hasEmailCredits(_workspaceId: string): Promise<boolean> {
    return true;
  }

  async validateEmailCreditsOrThrow(_workspaceId: string): Promise<void> {
    return;
  }

  async billSentEmails({
    workspaceId,
    sentEmailCount,
    userWorkspaceId,
  }: {
    workspaceId: string;
    sentEmailCount: number;
    userWorkspaceId?: string | null;
  }): Promise<void> {
    if (sentEmailCount <= 0) {
      return;
    }

    const providerCostInDollars =
      (sentEmailCount / 1000) * SES_EMAIL_COST_PER_THOUSAND_DOLLARS;
    const chargedInDollars = providerCostInDollars * EMAIL_MARGIN_MULTIPLIER;
    const creditsUsedMicro = Math.round(
      convertDollarsToBillingCredits(chargedInDollars),
    );

    const periodStart: Date | undefined = undefined;

    this.workspaceEventEmitter.emitCustomBatchEvent<UsageEvent>(
      USAGE_RECORDED,
      [
        {
          resourceType: UsageResourceType.EMAIL,
          operationType: UsageOperationType.EMAIL_SEND,
          creditsUsedMicro,
          quantity: sentEmailCount,
          unit: UsageUnit.INVOCATION,
          userWorkspaceId: userWorkspaceId || null,
          periodStart,
        },
      ],
      workspaceId,
    );
  }
}
