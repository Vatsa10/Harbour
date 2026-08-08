import { Module } from '@nestjs/common';

import { RecordPositionModule } from 'src/engine/core-modules/record-position/record-position.module';
import { WorkflowVersionCoreModule } from 'src/engine/core-modules/workflow/workflow-version-core.module';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { WorkflowDefinitionInstallResolver } from 'src/modules/workflow/workflow-templates/resolvers/workflow-definition-install.resolver';
import { WorkflowTemplateResolver } from 'src/modules/workflow/workflow-templates/resolvers/workflow-template.resolver';
import { WorkflowTemplateService } from 'src/modules/workflow/workflow-templates/services/workflow-template.service';
import { WorkflowTriggerModule } from 'src/modules/workflow/workflow-trigger/workflow-trigger.module';

// GlobalWorkspaceDataSourceModule is @Global(), so GlobalWorkspaceOrmManager
// needs no import here. WorkflowToolsModule already combines the other three
// without a cycle, which is the precedent for this import list.
@Module({
  // The resolvers' permission guard injects PermissionsService; without this
  // import Nest cannot resolve it and the whole application fails to boot.
  imports: [
    RecordPositionModule,
    WorkflowVersionCoreModule,
    WorkflowTriggerModule,
    PermissionsModule,
  ],
  providers: [
    WorkflowTemplateService,
    WorkflowTemplateResolver,
    WorkflowDefinitionInstallResolver,
  ],
  exports: [WorkflowTemplateService],
})
export class WorkflowTemplatesModule {}
