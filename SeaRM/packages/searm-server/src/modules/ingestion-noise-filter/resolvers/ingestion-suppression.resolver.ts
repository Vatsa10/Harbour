import { UseGuards, UsePipes } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';

import { PermissionFlagType } from 'searm-shared/constants';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import {
  IngestionSuppressionDTO,
  UpdateIngestionSuppressionInput,
} from 'src/modules/ingestion-noise-filter/dtos/ingestion-suppression.dto';
import { IngestionSuppressionService } from 'src/modules/ingestion-noise-filter/services/ingestion-suppression.service';

// Widening the suppression list decides what does and does not enter the CRM,
// so it sits behind the workspace admin flag rather than record permissions.
@UseGuards(
  WorkspaceAuthGuard,
  SettingsPermissionGuard(PermissionFlagType.WORKSPACE),
)
@UsePipes(ResolverValidationPipe)
@MetadataResolver()
export class IngestionSuppressionResolver {
  constructor(
    private readonly ingestionSuppressionService: IngestionSuppressionService,
  ) {}

  @Query(() => IngestionSuppressionDTO)
  async ingestionSuppression(
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<IngestionSuppressionDTO> {
    return this.ingestionSuppressionService.getSuppression(workspace.id);
  }

  @Mutation(() => IngestionSuppressionDTO)
  async updateIngestionSuppression(
    @Args('input') input: UpdateIngestionSuppressionInput,
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<IngestionSuppressionDTO> {
    return this.ingestionSuppressionService.setSuppression(workspace.id, input);
  }
}
