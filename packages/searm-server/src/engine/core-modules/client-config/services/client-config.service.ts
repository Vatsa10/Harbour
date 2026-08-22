import { Injectable } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'searm-shared/utils';

import { NodeEnvironment } from 'src/engine/core-modules/searm-config/interfaces/node-environment.interface';
import { SupportDriver } from 'src/engine/core-modules/searm-config/interfaces/support.interface';

import { MaintenanceModeService } from 'src/engine/core-modules/admin-panel/maintenance-mode.service';
import {
  type ClientAiModelConfig,
  type ClientConfig,
} from 'src/engine/core-modules/client-config/client-config.entity';
import { DomainServerConfigService } from 'src/engine/core-modules/domain/domain-server-config/services/domain-server-config.service';
import { EmailingDomainDriver } from 'src/engine/core-modules/emailing-domain/drivers/types/emailing-domain-driver.type';
import { PUBLIC_FEATURE_FLAGS } from 'src/engine/core-modules/feature-flag/constants/public-feature-flag.const';
import { SearmConfigService } from 'src/engine/core-modules/searm-config/searm-config.service';
import { toDisplayCredits } from 'src/engine/core-modules/usage/utils/to-display-credits.util';
import {
  AUTO_SELECT_FAST_MODEL_ID,
  AUTO_SELECT_SMART_MODEL_ID,
  ENTERPRISE_INSTANCE_TYPE,
} from 'searm-shared/constants';
import { MODEL_FAMILY_LABELS } from 'src/engine/metadata-modules/ai/ai-models/constants/model-family-labels.const';
import { getNativeModelCapabilities } from 'src/engine/metadata-modules/ai/ai-models/utils/get-native-model-capabilities.util';
import { AiModelRegistryService } from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service';

@Injectable()
export class ClientConfigService {
  constructor(
    private searmConfigService: SearmConfigService,
    private domainServerConfigService: DomainServerConfigService,
    private aiModelRegistryService: AiModelRegistryService,
    private maintenanceModeService: MaintenanceModeService,
  ) {}

  private isCloudflareIntegrationEnabled(): boolean {
    // Cloudflare custom domain feature is not supported in self-hosted deployments
    return false;
  }

  async getClientConfig(): Promise<ClientConfig> {
    const captchaProvider = this.searmConfigService.get('CAPTCHA_DRIVER');
    const supportDriver = this.searmConfigService.get('SUPPORT_DRIVER');
    const calendarBookingPageId = this.searmConfigService.get(
      'CALENDAR_BOOKING_PAGE_ID',
    );

    const isEmailingDomainInDemoMode =
      this.searmConfigService.get('EMAILING_DOMAIN_DRIVER') ===
      EmailingDomainDriver.LOG;


    const availableModels =
      this.aiModelRegistryService.getAdminFilteredModels();
    const recommendedModelIds =
      this.aiModelRegistryService.getRecommendedModelIds();
    const resolvedProviders =
      this.aiModelRegistryService.getResolvedProvidersForAdmin();

    const getProviderLabel = (providerName?: string | null) =>
      providerName
        ? (resolvedProviders[providerName]?.label ?? providerName)
        : undefined;

    const aiModels: ClientAiModelConfig[] = availableModels.map(
      (registeredModel) => {
        const modelConfig = this.aiModelRegistryService.getModelConfig(
          registeredModel.modelId,
        );

        const modelFamily = modelConfig?.modelFamily;
        const providerName = registeredModel.providerName;

        return {
          modelId: registeredModel.modelId,
          label: modelConfig?.label || registeredModel.modelId,
          modelFamily,
          modelFamilyLabel: modelFamily
            ? MODEL_FAMILY_LABELS[modelFamily]
            : undefined,
          sdkPackage: registeredModel.sdkPackage,
          providerName,
          providerLabel: getProviderLabel(providerName),
          nativeCapabilities: getNativeModelCapabilities(
            registeredModel.sdkPackage,
          ),
          inputCostPerMillionTokens: modelConfig?.inputCostPerMillionTokens,
          outputCostPerMillionTokens: modelConfig?.outputCostPerMillionTokens,
          contextWindowTokens: modelConfig?.contextWindowTokens,
          maxOutputTokens: modelConfig?.maxOutputTokens,
          isDeprecated: modelConfig?.isDeprecated,
          isRecommended: recommendedModelIds.has(registeredModel.modelId),
          dataResidency: modelConfig?.dataResidency,
        };
      },
    );

    if (aiModels.length > 0) {
      const defaultSpeedModel =
        this.aiModelRegistryService.getDefaultSpeedModel();
      const defaultSpeedModelConfig =
        this.aiModelRegistryService.getModelConfig(defaultSpeedModel?.modelId);

      const defaultPerformanceModel =
        this.aiModelRegistryService.getDefaultPerformanceModel();
      const defaultPerformanceModelConfig =
        this.aiModelRegistryService.getModelConfig(
          defaultPerformanceModel?.modelId,
        );

      aiModels.unshift(
        {
          modelId: AUTO_SELECT_SMART_MODEL_ID,
          label:
            defaultPerformanceModelConfig?.label ||
            defaultPerformanceModel?.modelId ||
            'Default',
          modelFamily: defaultPerformanceModelConfig?.modelFamily,
          providerName: defaultPerformanceModel?.providerName,
          providerLabel: getProviderLabel(
            defaultPerformanceModel?.providerName,
          ),
          sdkPackage: defaultPerformanceModel?.sdkPackage ?? null,
          nativeCapabilities: getNativeModelCapabilities(
            defaultPerformanceModel?.sdkPackage,
          ),
          inputCostPerMillionTokens:
            defaultPerformanceModelConfig?.inputCostPerMillionTokens,
          outputCostPerMillionTokens:
            defaultPerformanceModelConfig?.outputCostPerMillionTokens,
          contextWindowTokens:
            defaultPerformanceModelConfig?.contextWindowTokens,
          maxOutputTokens: defaultPerformanceModelConfig?.maxOutputTokens,
        },
        {
          modelId: AUTO_SELECT_FAST_MODEL_ID,
          label:
            defaultSpeedModelConfig?.label ||
            defaultSpeedModel?.modelId ||
            'Default',
          modelFamily: defaultSpeedModelConfig?.modelFamily,
          providerName: defaultSpeedModel?.providerName,
          providerLabel: getProviderLabel(defaultSpeedModel?.providerName),
          sdkPackage: defaultSpeedModel?.sdkPackage ?? null,
          nativeCapabilities: getNativeModelCapabilities(
            defaultSpeedModel?.sdkPackage,
          ),
          inputCostPerMillionTokens:
            defaultSpeedModelConfig?.inputCostPerMillionTokens,
          outputCostPerMillionTokens:
            defaultSpeedModelConfig?.outputCostPerMillionTokens,
          contextWindowTokens: defaultSpeedModelConfig?.contextWindowTokens,
          maxOutputTokens: defaultSpeedModelConfig?.maxOutputTokens,
        },
      );
    }

    const clientConfig: ClientConfig = {
      appVersion: this.searmConfigService.get('APP_VERSION'),
      // AGPL build: this distribution has no paid tiers, billing is always off.
      billing: {
        isBillingEnabled: false,
      },
      aiModels,
      authProviders: {
        google: this.searmConfigService.get('AUTH_GOOGLE_ENABLED'),
        magicLink: false,
        password: this.searmConfigService.get('AUTH_PASSWORD_ENABLED'),
        microsoft: this.searmConfigService.get('AUTH_MICROSOFT_ENABLED'),
        sso: [],
      },
      signInPrefilled: this.searmConfigService.get('SIGN_IN_PREFILLED'),
      isMultiWorkspaceEnabled: this.searmConfigService.get(
        'IS_MULTIWORKSPACE_ENABLED',
      ),
      isEmailVerificationRequired: this.searmConfigService.get(
        'IS_EMAIL_VERIFICATION_REQUIRED',
      ),
      defaultSubdomain: this.searmConfigService.get('DEFAULT_SUBDOMAIN'),
      frontDomain: this.domainServerConfigService.getFrontUrl().hostname,
      publicFunctionDomain:
        this.domainServerConfigService.getPublicBaseHostnameOrUndefined() ??
        null,
      support: {
        supportDriver: supportDriver ? supportDriver : SupportDriver.NONE,
        supportFrontChatId: this.searmConfigService.get(
          'SUPPORT_FRONT_CHAT_ID',
        ),
      },
      sentry: {
        environment: this.searmConfigService.get('SENTRY_ENVIRONMENT'),
        release: this.searmConfigService.get('APP_VERSION'),
        dsn: this.searmConfigService.get('SENTRY_FRONT_DSN'),
      },
      captcha: {
        provider: captchaProvider ? captchaProvider : undefined,
        siteKey: this.searmConfigService.get('CAPTCHA_SITE_KEY'),
      },
      api: {
        mutationMaximumAffectedRecords: this.searmConfigService.get(
          'MUTATION_MAXIMUM_AFFECTED_RECORDS',
        ),
      },
      onboarding: null,
      isAttachmentPreviewEnabled: this.searmConfigService.get(
        'IS_ATTACHMENT_PREVIEW_ENABLED',
      ),
      analyticsEnabled: this.searmConfigService.get('ANALYTICS_ENABLED'),
      canManageFeatureFlags:
        this.searmConfigService.get('NODE_ENV') ===
          NodeEnvironment.DEVELOPMENT ||
        this.searmConfigService.get('IS_FEATURE_FLAG_MANAGEMENT_ENABLED'),
      publicFeatureFlags: PUBLIC_FEATURE_FLAGS,
      isCookieSessionEnabled: this.searmConfigService.get(
        'AUTH_COOKIE_SESSIONS_ENABLED',
      ),
      isMicrosoftMessagingEnabled: this.searmConfigService.get(
        'MESSAGING_PROVIDER_MICROSOFT_ENABLED',
      ),
      isMicrosoftCalendarEnabled: this.searmConfigService.get(
        'CALENDAR_PROVIDER_MICROSOFT_ENABLED',
      ),
      isGoogleMessagingEnabled: this.searmConfigService.get(
        'MESSAGING_PROVIDER_GMAIL_ENABLED',
      ),
      isGoogleCalendarEnabled: this.searmConfigService.get(
        'CALENDAR_PROVIDER_GOOGLE_ENABLED',
      ),
      isConfigVariablesInDbEnabled: this.searmConfigService.get(
        'IS_CONFIG_VARIABLES_IN_DB_ENABLED',
      ),
      isImapSmtpCaldavEnabled: this.searmConfigService.get(
        'IS_IMAP_SMTP_CALDAV_ENABLED',
      ),
      isEmailingDomainInDemoMode,
      allowRequestsToSearmIcons: this.searmConfigService.get(
        'ALLOW_REQUESTS_TO_SEARM_ICONS',
      ),
      calendarBookingPageId: isNonEmptyString(calendarBookingPageId)
        ? calendarBookingPageId
        : undefined,
      isCloudflareIntegrationEnabled: this.isCloudflareIntegrationEnabled(),
      isClickHouseConfigured: !!this.searmConfigService.get('CLICKHOUSE_URL'),
      isWorkspaceSchemaDDLLocked: this.searmConfigService.get(
        'WORKSPACE_SCHEMA_DDL_LOCKED',
      ),
      isOnboardingAiChatEnabled: this.searmConfigService.get(
        'IS_ONBOARDING_AI_CHAT_ENABLED',
      ),
      enterpriseInstanceType:
        this.searmConfigService.get('ENTERPRISE_INSTANCE_TYPE') ??
        ENTERPRISE_INSTANCE_TYPE.PRODUCTION,
    };

    const maintenanceMode =
      await this.maintenanceModeService.getMaintenanceMode();

    if (isDefined(maintenanceMode)) {
      clientConfig.maintenance = {
        startAt: new Date(maintenanceMode.startAt),
        endAt: new Date(maintenanceMode.endAt),
        link: maintenanceMode.link,
      };
    }

    return clientConfig;
  }
}
