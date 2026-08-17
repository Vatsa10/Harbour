import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NotificationEntity } from 'src/engine/core-modules/notification/entities/notification.entity';
import { NotificationResolver } from 'src/engine/core-modules/notification/resolvers/notification.resolver';
import { NotificationService } from 'src/engine/core-modules/notification/services/notification.service';

@Module({
  imports: [TypeOrmModule.forFeature([NotificationEntity])],
  providers: [NotificationService, NotificationResolver],
  exports: [NotificationService],
})
export class NotificationModule {}
