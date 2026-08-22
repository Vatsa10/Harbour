import { Module } from '@nestjs/common';

import { SearmConfigModule } from 'src/engine/core-modules/searm-config/searm-config.module';

import { ClickHouseService } from './clickHouse.service';

@Module({
  imports: [SearmConfigModule],
  providers: [ClickHouseService],
  exports: [ClickHouseService],
})
export class ClickHouseModule {}
