import { type DynamicModule, Global } from '@nestjs/common';

import { CaptchaDriverFactory } from 'src/engine/core-modules/captcha/captcha-driver.factory';
import { CaptchaService } from 'src/engine/core-modules/captcha/captcha.service';
import { SecureHttpClientModule } from 'src/engine/core-modules/secure-http-client/secure-http-client.module';
import { SearmConfigModule } from 'src/engine/core-modules/searm-config/searm-config.module';

@Global()
export class CaptchaModule {
  static forRoot(): DynamicModule {
    return {
      module: CaptchaModule,
      imports: [SearmConfigModule, SecureHttpClientModule],
      providers: [CaptchaDriverFactory, CaptchaService],
      exports: [CaptchaService],
    };
  }
}
