import { type DynamicModule, Global, Module } from '@nestjs/common';

import { ConfigVariables } from 'src/engine/core-modules/searm-config/config-variables';
import { CONFIG_VARIABLES_INSTANCE_TOKEN } from 'src/engine/core-modules/searm-config/constants/config-variables-instance-tokens.constants';
import { DatabaseConfigModule } from 'src/engine/core-modules/searm-config/drivers/database-config.module';
import { ConfigGroupHashService } from 'src/engine/core-modules/searm-config/services/config-group-hash.service';
import { ConfigurableModuleClass } from 'src/engine/core-modules/searm-config/searm-config.module-definition';
import { SearmConfigService } from 'src/engine/core-modules/searm-config/searm-config.service';

@Global()
@Module({})
export class SearmConfigModule extends ConfigurableModuleClass {
  static forRoot(): DynamicModule {
    const isConfigVariablesInDbEnabled =
      process.env.IS_CONFIG_VARIABLES_IN_DB_ENABLED !== 'false';

    const imports = isConfigVariablesInDbEnabled
      ? [DatabaseConfigModule.forRoot()]
      : [];

    return {
      module: SearmConfigModule,
      imports,
      providers: [
        SearmConfigService,
        ConfigGroupHashService,
        {
          provide: CONFIG_VARIABLES_INSTANCE_TOKEN,
          useValue: new ConfigVariables(),
        },
      ],
      exports: [SearmConfigService, ConfigGroupHashService],
    };
  }
}
