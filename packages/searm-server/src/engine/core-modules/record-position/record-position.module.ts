import { Module } from '@nestjs/common';

import { SearmORMModule } from 'src/engine/searm-orm/searm-orm.module';

import { RecordPositionService } from './services/record-position.service';

@Module({
  imports: [SearmORMModule],
  providers: [RecordPositionService],
  exports: [RecordPositionService],
})
export class RecordPositionModule {}
