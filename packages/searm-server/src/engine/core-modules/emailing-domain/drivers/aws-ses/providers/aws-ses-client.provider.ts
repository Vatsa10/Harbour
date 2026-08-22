import { Injectable } from '@nestjs/common';

import {
  SESv2Client as SESClient,
  type SESv2ClientConfig as SESClientConfig,
} from '@aws-sdk/client-sesv2';

import { SearmConfigService } from 'src/engine/core-modules/searm-config/searm-config.service';

@Injectable()
export class AwsSesClientProvider {
  private sesClient: SESClient | null = null;

  constructor(private readonly searmConfigService: SearmConfigService) {}

  public getSESClient(): SESClient {
    if (!this.sesClient) {
      const config: SESClientConfig = {
        region: this.searmConfigService.get('AWS_SES_REGION'),
      };

      const accessKeyId = this.searmConfigService.get('AWS_SES_ACCESS_KEY_ID');
      const secretAccessKey = this.searmConfigService.get(
        'AWS_SES_SECRET_ACCESS_KEY',
      );
      const sessionToken = this.searmConfigService.get(
        'AWS_SES_SESSION_TOKEN',
      );

      if (accessKeyId && secretAccessKey) {
        config.credentials = {
          accessKeyId,
          secretAccessKey,
          ...(sessionToken ? { sessionToken } : {}),
        };
      }

      this.sesClient = new SESClient(config);
    }

    return this.sesClient;
  }
}
