import { Injectable } from '@nestjs/common';

import { MetricsService } from 'src/engine/core-modules/metrics/metrics.service';
import { MetricsKeys } from 'src/engine/core-modules/metrics/types/metrics-keys.type';
import {
  ThrottlerException,
  ThrottlerExceptionCode,
} from 'src/engine/core-modules/throttler/throttler.exception';
import { ThrottlerService } from 'src/engine/core-modules/throttler/throttler.service';
import { SearmConfigService } from 'src/engine/core-modules/searm-config/searm-config.service';

@Injectable()
export class ApplicationJobEnqueueThrottlerService {
  constructor(
    private readonly throttlerService: ThrottlerService,
    private readonly searmConfigService: SearmConfigService,
    private readonly metricsService: MetricsService,
  ) {}

  async throttleOrThrow({
    applicationId,
    applicationRegistrationId,
    jobCount = 1,
  }: {
    applicationId: string;
    applicationRegistrationId: string;
    jobCount?: number;
  }): Promise<void> {
    const timeWindow = this.searmConfigService.get(
      'APPLICATION_JOB_ENQUEUE_RATE_LIMITING_TTL_IN_MS',
    );
    const applicationKey = `enqueue:throttler:application:${applicationId}`;
    const applicationLimit = this.searmConfigService.get(
      'APPLICATION_JOB_ENQUEUE_RATE_LIMITING_LIMIT',
    );
    const registrationKey = `enqueue:throttler:application-registration:${applicationRegistrationId}`;
    const registrationLimit = this.searmConfigService.get(
      'APPLICATION_REGISTRATION_JOB_ENQUEUE_RATE_LIMITING_LIMIT',
    );

    const [applicationTokens, registrationTokens] = await Promise.all([
      this.throttlerService.getAvailableTokensCount(
        applicationKey,
        applicationLimit,
        timeWindow,
      ),
      this.throttlerService.getAvailableTokensCount(
        registrationKey,
        registrationLimit,
        timeWindow,
      ),
    ]);

    if (applicationTokens < jobCount || registrationTokens < jobCount) {
      await this.metricsService.incrementCounterForEvent({
        key: MetricsKeys.JobEnqueueApplicationRateLimited,
        shouldStoreInCache: false,
        attributes: {
          application_id: applicationId,
          application_registration_id: applicationRegistrationId,
        },
      });

      throw new ThrottlerException(
        'Application job enqueue limit reached',
        ThrottlerExceptionCode.LIMIT_REACHED,
      );
    }

    await Promise.all([
      this.throttlerService.consumeTokens(
        applicationKey,
        jobCount,
        applicationLimit,
        timeWindow,
      ),
      this.throttlerService.consumeTokens(
        registrationKey,
        jobCount,
        registrationLimit,
        timeWindow,
      ),
    ]);
  }
}
