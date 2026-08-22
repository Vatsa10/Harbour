import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query } from '@nestjs/graphql';

import { PermissionFlagType } from 'searm-shared/constants';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import {
  RecordBriefDTO,
  RecordBriefGenerationResultDTO,
} from 'src/engine/metadata-modules/ai/ai-research/dtos/record-brief.dto';
import { RecordBriefService } from 'src/engine/metadata-modules/ai/ai-research/services/record-brief.service';

@UseGuards(WorkspaceAuthGuard, SettingsPermissionGuard(PermissionFlagType.AI))
@MetadataResolver()
export class RecordBriefResolver {
  constructor(private readonly recordBriefService: RecordBriefService) {}

  // Nullable on purpose. "No brief for this record" is the ordinary answer for
  // most records and must not read as an error to the client.
  @Query(() => RecordBriefDTO, { nullable: true })
  async recordBrief(
    @AuthWorkspace() workspace: FlatWorkspace,
    @Args('objectNameSingular', { type: () => String })
    objectNameSingular: string,
    @Args('recordId', { type: () => ID }) recordId: string,
  ): Promise<RecordBriefDTO | null> {
    const brief = await this.recordBriefService.findBrief({
      workspaceId: workspace.id,
      objectNameSingular,
      recordId,
    });

    return brief as RecordBriefDTO | null;
  }

  @Mutation(() => RecordBriefGenerationResultDTO)
  async generateRecordBrief(
    @AuthWorkspace() workspace: FlatWorkspace,
    @Args('objectNameSingular', { type: () => String })
    objectNameSingular: string,
    @Args('recordId', { type: () => ID }) recordId: string,
  ): Promise<RecordBriefGenerationResultDTO> {
    const result = await this.recordBriefService.generateBrief({
      workspaceId: workspace.id,
      objectNameSingular,
      recordId,
    });

    return result.written
      ? { brief: result.brief as RecordBriefDTO, refusalReason: null }
      : { brief: null, refusalReason: result.reason };
  }
}
