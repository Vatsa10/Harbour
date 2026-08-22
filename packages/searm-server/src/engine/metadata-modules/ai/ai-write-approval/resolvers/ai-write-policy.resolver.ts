import { UseGuards, UsePipes } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';

import { PermissionFlagType } from 'searm-shared/constants';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import {
  AiWritePolicyDTO,
  UpdateAiWritePolicyInput,
} from 'src/engine/metadata-modules/ai/ai-write-approval/dtos/ai-write-policy.dto';
import { AiWritePolicyService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/ai-write-policy.service';
import {
  isAiWriteMode,
  type AiWriteMode,
  type AiWritePolicy,
} from 'src/engine/metadata-modules/ai/ai-write-approval/types/ai-write-policy.type';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';

// The policy is deliberately not a workspace record: a user with record write
// permissions must not be able to disable the gate on themselves.
@UseGuards(
  WorkspaceAuthGuard,
  SettingsPermissionGuard(PermissionFlagType.AI_SETTINGS),
)
@UsePipes(ResolverValidationPipe)
@MetadataResolver()
export class AiWritePolicyResolver {
  constructor(private readonly aiWritePolicyService: AiWritePolicyService) {}

  @Query(() => AiWritePolicyDTO)
  async aiWritePolicy(
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<AiWritePolicyDTO> {
    return this.aiWritePolicyService.getPolicy(workspace.id);
  }

  @Mutation(() => AiWritePolicyDTO)
  async updateAiWritePolicy(
    @Args('input') input: UpdateAiWritePolicyInput,
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<AiWritePolicyDTO> {
    // The pipe has already rejected anything that is not a mode; narrowing
    // here keeps the stored blob typed rather than cast.
    const policy: AiWritePolicy = {
      default: input.default as AiWriteMode,
      overrides: Object.fromEntries(
        Object.entries(input.overrides).filter(
          (entry): entry is [string, AiWriteMode] => isAiWriteMode(entry[1]),
        ),
      ),
    };

    await this.aiWritePolicyService.setPolicy(workspace.id, policy);

    return policy;
  }
}
