import { Injectable } from '@nestjs/common';

import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

import {
  type LogicFunctionDriver,
  LogicFunctionDriverType,
} from 'src/engine/core-modules/logic-function/logic-function-drivers/interfaces/logic-function-driver.interface';

import { CacheLockService } from 'src/engine/core-modules/cache-lock/cache-lock.service';
import { DisabledDriver } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/disabled.driver';
import { LambdaDriver } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda.driver';
import { LocalDriver } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/local.driver';
import { getLambdaResourceNamespace } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/utils/get-lambda-resource-namespace.util';
import { LogicFunctionResourceService } from 'src/engine/core-modules/logic-function/logic-function-resource/logic-function-resource.service';
import { SdkClientArchiveService } from 'src/engine/core-modules/sdk-client/sdk-client-archive.service';
import { DriverFactoryBase } from 'src/engine/core-modules/searm-config/dynamic-factory.base';
import { ConfigVariablesGroup } from 'src/engine/core-modules/searm-config/enums/config-variables-group.enum';
import { ConfigGroupHashService } from 'src/engine/core-modules/searm-config/services/config-group-hash.service';
import { SearmConfigService } from 'src/engine/core-modules/searm-config/searm-config.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

@Injectable()
export class LogicFunctionDriverFactory extends DriverFactoryBase<LogicFunctionDriver> {
  constructor(
    searmConfigService: SearmConfigService,
    configGroupHashService: ConfigGroupHashService,
    private readonly logicFunctionResourceService: LogicFunctionResourceService,
    private readonly sdkClientArchiveService: SdkClientArchiveService,
    private readonly cacheLockService: CacheLockService,
    private readonly workspaceCacheService: WorkspaceCacheService,
  ) {
    super(searmConfigService, configGroupHashService);
  }

  protected buildConfigKey(): string {
    const driverType = this.searmConfigService.get('LOGIC_FUNCTION_TYPE');

    if (driverType === LogicFunctionDriverType.LAMBDA) {
      return `lambda|${this.configGroupHashService.computeHash(ConfigVariablesGroup.LOGIC_FUNCTION_CONFIG)}`;
    }

    return driverType;
  }

  protected createDriver(): LogicFunctionDriver {
    const driverType = this.searmConfigService.get('LOGIC_FUNCTION_TYPE');

    switch (driverType) {
      case LogicFunctionDriverType.DISABLED:
        return new DisabledDriver();

      case LogicFunctionDriverType.LOCAL:
        return new LocalDriver({
          logicFunctionResourceService: this.logicFunctionResourceService,
          sdkClientArchiveService: this.sdkClientArchiveService,
          cacheLockService: this.cacheLockService,
          workspaceCacheService: this.workspaceCacheService,
        });

      case LogicFunctionDriverType.LAMBDA: {
        const region = this.searmConfigService.get(
          'LOGIC_FUNCTION_LAMBDA_REGION',
        );
        const accessKeyId = this.searmConfigService.get(
          'LOGIC_FUNCTION_LAMBDA_ACCESS_KEY_ID',
        );
        const secretAccessKey = this.searmConfigService.get(
          'LOGIC_FUNCTION_LAMBDA_SECRET_ACCESS_KEY',
        );
        const lambdaRole = this.searmConfigService.get(
          'LOGIC_FUNCTION_LAMBDA_ROLE',
        );
        const subhostingRole = this.searmConfigService.get(
          'LOGIC_FUNCTION_LAMBDA_SUBHOSTING_ROLE',
        );
        const s3BucketName = this.searmConfigService.get('STORAGE_S3_NAME');
        const layerBucket =
          this.searmConfigService.get('LOGIC_FUNCTION_LAMBDA_LAYER_BUCKET') ??
          s3BucketName ??
          'searm-lambda-layer';
        const layerBucketRegion =
          this.searmConfigService.get(
            'LOGIC_FUNCTION_LAMBDA_LAYER_BUCKET_REGION',
          ) ?? region;
        const resourceNamespace = getLambdaResourceNamespace({
          lambdaRoleArn: lambdaRole,
        });

        return new LambdaDriver({
          logicFunctionResourceService: this.logicFunctionResourceService,
          cacheLockService: this.cacheLockService,
          workspaceCacheService: this.workspaceCacheService,
          credentials: accessKeyId
            ? { accessKeyId, secretAccessKey }
            : fromNodeProviderChain({ clientConfig: { region } }),
          region,
          lambdaRole,
          subhostingRole,
          layerBucket,
          layerBucketRegion,
          resourceNamespace,
          sdkClientArchiveService: this.sdkClientArchiveService,
        });
      }

      default:
        throw new Error(
          `Invalid logic function driver type (${driverType}), check your .env file`,
        );
    }
  }
}
