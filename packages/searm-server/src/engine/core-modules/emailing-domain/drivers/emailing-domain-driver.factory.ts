import { Injectable } from '@nestjs/common';

import { type AwsSesDriverConfig } from 'src/engine/core-modules/emailing-domain/drivers/interfaces/driver-config.interface';
import { type EmailingDomainDriverInterface } from 'src/engine/core-modules/emailing-domain/drivers/interfaces/emailing-domain-driver.interface';

import { AwsSesClientProvider } from 'src/engine/core-modules/emailing-domain/drivers/aws-ses/providers/aws-ses-client.provider';
import { AwsSesRegisterDomainService } from 'src/engine/core-modules/emailing-domain/drivers/aws-ses/services/aws-ses-register-domain.service';
import { AwsSesDriver } from 'src/engine/core-modules/emailing-domain/drivers/aws-ses/services/aws-ses-driver.service';
import { AwsSesHandleErrorService } from 'src/engine/core-modules/emailing-domain/drivers/aws-ses/services/aws-ses-handle-error.service';
import { AwsSesSendEmailService } from 'src/engine/core-modules/emailing-domain/drivers/aws-ses/services/aws-ses-send-email.service';
import { LogEmailingDomainDriver } from 'src/engine/core-modules/emailing-domain/drivers/log/services/log-emailing-domain-driver.service';
import { EmailingDomainDriver } from 'src/engine/core-modules/emailing-domain/drivers/types/emailing-domain-driver.type';
import { UnsubscribeContentService } from 'src/engine/core-modules/emailing-domain/services/unsubscribe-content.service';
import { DriverFactoryBase } from 'src/engine/core-modules/searm-config/dynamic-factory.base';
import { ConfigVariablesGroup } from 'src/engine/core-modules/searm-config/enums/config-variables-group.enum';
import { ConfigGroupHashService } from 'src/engine/core-modules/searm-config/services/config-group-hash.service';
import { SearmConfigService } from 'src/engine/core-modules/searm-config/searm-config.service';

@Injectable()
export class EmailingDomainDriverFactory extends DriverFactoryBase<EmailingDomainDriverInterface> {
  constructor(
    searmConfigService: SearmConfigService,
    configGroupHashService: ConfigGroupHashService,
    private readonly awsSesClientProvider: AwsSesClientProvider,
    private readonly awsSesHandleErrorService: AwsSesHandleErrorService,
    private readonly awsSesRegisterDomainService: AwsSesRegisterDomainService,
    private readonly awsSesSendEmailService: AwsSesSendEmailService,
    private readonly logEmailingDomainDriver: LogEmailingDomainDriver,
    private readonly unsubscribeContentService: UnsubscribeContentService,
  ) {
    super(searmConfigService, configGroupHashService);
  }

  protected buildConfigKey(): string {
    const driver = this.searmConfigService.get('EMAILING_DOMAIN_DRIVER');

    switch (driver) {
      case EmailingDomainDriver.AWS_SES: {
        const awsConfigHash = this.configGroupHashService.computeHash(
          ConfigVariablesGroup.AWS_SES_SETTINGS,
        );

        return `aws-ses|${awsConfigHash}`;
      }
      case EmailingDomainDriver.LOG:
        return 'log';
      default:
        throw new Error(`Unsupported emailing domain driver: ${driver}`);
    }
  }

  protected createDriver(): EmailingDomainDriverInterface {
    const driver = this.searmConfigService.get('EMAILING_DOMAIN_DRIVER');

    switch (driver) {
      case EmailingDomainDriver.AWS_SES: {
        const region = this.searmConfigService.get('AWS_SES_REGION');
        const accountId = this.searmConfigService.get('AWS_SES_ACCOUNT_ID');
        const accessKeyId = this.searmConfigService.get(
          'AWS_SES_ACCESS_KEY_ID',
        );
        const secretAccessKey = this.searmConfigService.get(
          'AWS_SES_SECRET_ACCESS_KEY',
        );
        const sessionToken = this.searmConfigService.get(
          'AWS_SES_SESSION_TOKEN',
        );

        const awsConfig: AwsSesDriverConfig = {
          driver: EmailingDomainDriver.AWS_SES,
          region,
          accountId,
          accessKeyId,
          secretAccessKey,
          sessionToken,
        };

        return new AwsSesDriver(
          awsConfig,
          this.awsSesClientProvider,
          this.awsSesHandleErrorService,
          this.awsSesRegisterDomainService,
          this.awsSesSendEmailService,
          this.unsubscribeContentService,
        );
      }

      case EmailingDomainDriver.LOG:
        return this.logEmailingDomainDriver;

      default:
        throw new Error(`Invalid emailing domain driver: ${driver}`);
    }
  }
}
