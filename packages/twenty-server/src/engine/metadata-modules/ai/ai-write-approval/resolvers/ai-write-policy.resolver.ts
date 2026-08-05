import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';

import { PermissionFlagType } from 'twenty-shared/constants';

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
import { type AiWritePolicy } from 'src/engine/metadata-modules/ai/ai-write-approval/types/ai-write-policy.type';

// The policy is deliberately not a workspace record: a user with record write
// permissions must not be able to disable the gate on themselves.
@UseGuards(
  WorkspaceAuthGuard,
  SettingsPermissionGuard(PermissionFlagType.AI_SETTINGS),
)
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
    const policy = input as AiWritePolicy;

    await this.aiWritePolicyService.setPolicy(workspace.id, policy);

    return policy;
  }
}
