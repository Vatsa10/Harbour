import { Global, Module } from '@nestjs/common';

import { RedisClientService } from 'src/engine/core-modules/redis-client/redis-client.service';
import { SearmConfigModule } from 'src/engine/core-modules/searm-config/searm-config.module';

@Global()
@Module({
  imports: [SearmConfigModule],
  providers: [RedisClientService],
  exports: [RedisClientService],
})
export class RedisClientModule {}
