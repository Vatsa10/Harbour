import { Module } from '@nestjs/common';

import { WellKnownController } from 'src/engine/core-modules/well-known/controllers/well-known.controller';
import { SearmConfigModule } from 'src/engine/core-modules/searm-config/searm-config.module';

@Module({
  imports: [SearmConfigModule],
  controllers: [WellKnownController],
})
export class WellKnownModule {}
