import { UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import { Args, Query } from '@nestjs/graphql';

import { PermissionFlagType } from 'twenty-shared/constants';
import { FeatureFlagKey } from 'twenty-shared/types';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { FindMessageSuppressionsInput } from 'src/engine/core-modules/emailing-domain/dtos/find-message-suppressions.input';
import { MessageSuppressionListDTO } from 'src/engine/core-modules/emailing-domain/dtos/message-suppression.dto';
import { EmailingDomainGraphqlApiExceptionFilter } from 'src/engine/core-modules/emailing-domain/filters/emailing-domain-graphql-api-exception.filter';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import {
  FeatureFlagGuard,
  RequireFeatureFlag,
} from 'src/engine/guards/feature-flag.guard';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { MessageSuppressionService } from 'src/modules/emailing/services/message-suppression.service';

@UseGuards(
  WorkspaceAuthGuard,
  FeatureFlagGuard,
  SettingsPermissionGuard(PermissionFlagType.WORKSPACE),
)
@UseFilters(
  EmailingDomainGraphqlApiExceptionFilter,
)
@UsePipes(ResolverValidationPipe)
@MetadataResolver(() => MessageSuppressionListDTO)
export class MessageSuppressionResolver {
  constructor(
    private readonly messageSuppressionService: MessageSuppressionService,
  ) {}

  @Query(() => MessageSuppressionListDTO)
  @RequireFeatureFlag(FeatureFlagKey.IS_EMAIL_GROUP_ENABLED)
  async messageSuppressions(
    @Args('input') input: FindMessageSuppressionsInput,
    @AuthWorkspace() currentWorkspace: WorkspaceEntity,
  ): Promise<MessageSuppressionListDTO> {
    return this.messageSuppressionService.findSuppressions({
      workspaceId: currentWorkspace.id,
      reason: input.reason,
      searchTerm: input.searchTerm,
      unsubscribeTopicId: input.unsubscribeTopicId,
      limit: input.limit,
      offset: input.offset,
    });
  }
}
