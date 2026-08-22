import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CacheStorageModule } from 'src/engine/core-modules/cache-storage/cache-storage.module';
import { SSOService } from 'src/engine/core-modules/sso/services/sso.service';
import { SSOResolver } from 'src/engine/core-modules/sso/sso.resolver';
import { WorkspaceSSOIdentityProviderEntity } from 'src/engine/core-modules/sso/workspace-sso-identity-provider.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkspaceSSOIdentityProviderEntity]),
    CacheStorageModule,
  ],
  providers: [SSOService, SSOResolver],
  exports: [SSOService],
})
export class WorkspaceSSOModule {}
