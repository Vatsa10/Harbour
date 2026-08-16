import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FeatureFlagEntity } from 'src/engine/core-modules/feature-flag/feature-flag.entity';
import { SecureHttpClientModule } from 'src/engine/core-modules/secure-http-client/secure-http-client.module';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { WorkspaceDataSourceModule } from 'src/engine/workspace-datasource/workspace-datasource.module';
import { CreateCompanyAndPersonService } from 'src/modules/contact-creation-manager/services/create-company-and-contact.service';
import { ContactAutoCreatePolicyService } from 'src/modules/contact-creation-manager/services/contact-auto-create-policy.service';
import { CreateCompanyService } from 'src/modules/contact-creation-manager/services/create-company.service';
import { CreatePersonService } from 'src/modules/contact-creation-manager/services/create-person.service';
import { IngestionNoiseFilterModule } from 'src/modules/ingestion-noise-filter/ingestion-noise-filter.module';

@Module({
  imports: [
    WorkspaceDataSourceModule,
    TypeOrmModule.forFeature([
      FeatureFlagEntity,
      UserWorkspaceEntity,
      WorkspaceEntity,
    ]),
    TypeOrmModule.forFeature([ObjectMetadataEntity, FieldMetadataEntity]),
    SecureHttpClientModule,
    IngestionNoiseFilterModule,
  ],
  providers: [
    ContactAutoCreatePolicyService,
    CreateCompanyService,
    CreatePersonService,
    CreateCompanyAndPersonService,
  ],
  exports: [CreateCompanyAndPersonService, ContactAutoCreatePolicyService],
})
export class ContactCreationManagerModule {}
