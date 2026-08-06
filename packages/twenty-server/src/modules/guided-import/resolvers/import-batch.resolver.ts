import { BadRequestException, UseGuards } from '@nestjs/common';
import { Args, Mutation } from '@nestjs/graphql';
import { InjectRepository } from '@nestjs/typeorm';

import { PermissionFlagType } from 'twenty-shared/constants';
import { type Repository } from 'typeorm';
import { type QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { AuthUserWorkspaceId } from 'src/engine/decorators/auth/auth-user-workspace-id.decorator';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { CreateImportBatchInput } from 'src/modules/guided-import/dtos/create-import-batch.input';
import { ImportBatchDTO } from 'src/modules/guided-import/dtos/import-batch.dto';
import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import { ImportBatchStatus } from 'src/modules/guided-import/types/import-batch-status.type';

@UseGuards(
  WorkspaceAuthGuard,
  SettingsPermissionGuard(PermissionFlagType.IMPORT_CSV),
)
@MetadataResolver()
export class ImportBatchResolver {
  constructor(
    // Staging tables are core-schema platform infrastructure, not
    // workspace-object data, so the scoped repository wrapper doesn't apply.
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(ImportBatchEntity)
    private readonly importBatchRepository: Repository<ImportBatchEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(ImportRowEntity)
    private readonly importRowRepository: Repository<ImportRowEntity>,
  ) {}

  @Mutation(() => ImportBatchDTO)
  async createImportBatch(
    @Args('input') input: CreateImportBatchInput,
    @AuthWorkspace() workspace: FlatWorkspace,
    @AuthUserWorkspaceId() userWorkspaceId: string,
  ): Promise<ImportBatchDTO> {
    if (input.rawRows.length === 0) {
      throw new BadRequestException('Cannot import an empty file.');
    }

    if (input.rawRows.length !== input.mappedRows.length) {
      throw new BadRequestException(
        'rawRows and mappedRows must be the same length.',
      );
    }

    const batch = await this.importBatchRepository.save({
      workspaceId: workspace.id,
      objectNameSingular: input.objectNameSingular,
      fileName: input.fileName,
      status: ImportBatchStatus.PENDING,
      mappingConfig: input.columnMapping,
      totalRows: input.rawRows.length,
      createdByUserWorkspaceId: userWorkspaceId,
    });

    // TypeORM's QueryDeepPartialEntity narrows jsonb columns in a way that
    // rejects a plain Record<string, unknown> - the runtime value is correct.
    await this.importRowRepository.insert(
      input.rawRows.map((row, index) => ({
        importBatchId: batch.id,
        rowNumber: index + 1,
        rawData: row,
        mappedData: input.mappedRows[index],
      })) as QueryDeepPartialEntity<ImportRowEntity>[],
    );

    return batch as unknown as ImportBatchDTO;
  }
}
