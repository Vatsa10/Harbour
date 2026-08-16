import { BadRequestException, UseGuards } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';
import { InjectRepository } from '@nestjs/typeorm';

import { PermissionFlagType } from 'twenty-shared/constants';
import { type Repository } from 'typeorm';
import { type QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { AuthUserWorkspaceId } from 'src/engine/decorators/auth/auth-user-workspace-id.decorator';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { IMPORT_BATCH_MAX_ROWS } from 'src/modules/guided-import/constants/import-batch-limits.constant';
import { CreateImportBatchInput } from 'src/modules/guided-import/dtos/create-import-batch.input';
import { ImportBatchPreviewDTO } from 'src/modules/guided-import/dtos/import-batch-preview.dto';
import { ImportBatchDTO } from 'src/modules/guided-import/dtos/import-batch.dto';
import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import {
  ImportExecutionJob,
  type ImportExecutionJobData,
} from 'src/modules/guided-import/jobs/import-execution.job';
import { ImportMatchResolutionService } from 'src/modules/guided-import/services/import-match-resolution.service';
import { ImportValidationService } from 'src/modules/guided-import/services/import-validation.service';
import {
  ImportBatchStatus,
  ImportRowMatchAction,
  ImportRowStatus,
} from 'src/modules/guided-import/types/import-batch-status.type';

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
    private readonly importMatchResolutionService: ImportMatchResolutionService,
    private readonly importValidationService: ImportValidationService,
    @InjectMessageQueue(MessageQueue.importQueue)
    private readonly messageQueueService: MessageQueueService,
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

    if (input.rawRows.length > IMPORT_BATCH_MAX_ROWS) {
      throw new BadRequestException(
        `Cannot import more than ${IMPORT_BATCH_MAX_ROWS} rows in one batch.`,
      );
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

  // Runs match resolution then validation so the reviewer's preview reflects
  // a batch where every row already has a matchAction and a
  // validationErrors verdict.
  @Mutation(() => ImportBatchDTO)
  async prepareImportBatch(
    @Args('importBatchId') importBatchId: string,
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<ImportBatchDTO> {
    const batch = await this.importBatchRepository.findOne({
      where: { id: importBatchId, workspaceId: workspace.id },
    });

    if (!batch) {
      throw new BadRequestException('Import batch not found.');
    }

    await this.importMatchResolutionService.resolveBatch(
      importBatchId,
      workspace.id,
    );
    await this.importValidationService.validateBatch(
      importBatchId,
      workspace.id,
    );

    const readyBatch = await this.importBatchRepository.save({
      ...batch,
      status: ImportBatchStatus.READY,
    });

    return readyBatch as unknown as ImportBatchDTO;
  }

  // Enqueues rather than executing inline: the batch may be tens of thousands
  // of rows, and the job is resumable, so a crashed worker retry is safe.
  @Mutation(() => ImportBatchDTO)
  async startImportBatch(
    @Args('importBatchId') importBatchId: string,
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<ImportBatchDTO> {
    const batch = await this.importBatchRepository.findOne({
      where: { id: importBatchId, workspaceId: workspace.id },
    });

    if (!batch || batch.status !== ImportBatchStatus.READY) {
      throw new BadRequestException(
        'Import batch must be prepared (READY) before it can start.',
      );
    }

    const runningBatch = await this.importBatchRepository.save({
      ...batch,
      status: ImportBatchStatus.RUNNING,
    });

    await this.messageQueueService.add<ImportExecutionJobData>(
      ImportExecutionJob.name,
      { workspaceId: workspace.id, importBatchId },
    );

    return runningBatch as unknown as ImportBatchDTO;
  }

  // Resets FAILED rows to PENDING and re-enqueues the resumable execution
  // job, which processes only PENDING rows and leaves already-succeeded
  // rows untouched.
  @Mutation(() => ImportBatchDTO)
  async retryFailedImportRows(
    @Args('importBatchId') importBatchId: string,
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<ImportBatchDTO> {
    const batch = await this.importBatchRepository.findOne({
      where: { id: importBatchId, workspaceId: workspace.id },
    });

    if (!batch) {
      throw new BadRequestException('Import batch not found.');
    }

    // A batch that is still RUNNING already has a job working its rows.
    // Enqueueing a second one over it would put two executions on the same
    // batch, and would reset rows the live run is about to write.
    if (batch.status === ImportBatchStatus.RUNNING) {
      throw new BadRequestException(
        'This import is still running. Wait for it to finish before retrying failed rows.',
      );
    }

    const failedRows = await this.importRowRepository.find({
      where: { importBatchId, status: ImportRowStatus.FAILED },
    });

    // Nothing to retry: leave the batch COMPLETED rather than flipping it to
    // RUNNING for a job that would immediately find no work.
    if (failedRows.length === 0) {
      return batch as unknown as ImportBatchDTO;
    }

    for (const row of failedRows) {
      await this.importRowRepository.save({
        ...row,
        status: ImportRowStatus.PENDING,
        errorMessage: null,
        leasedAt: null,
      });
    }

    const runningBatch = await this.importBatchRepository.save({
      ...batch,
      status: ImportBatchStatus.RUNNING,
    });

    await this.messageQueueService.add<ImportExecutionJobData>(
      ImportExecutionJob.name,
      { workspaceId: workspace.id, importBatchId },
    );

    return runningBatch as unknown as ImportBatchDTO;
  }

  @Query(() => ImportBatchPreviewDTO)
  async importBatchPreview(
    @Args('importBatchId') importBatchId: string,
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<ImportBatchPreviewDTO> {
    const batch = await this.importBatchRepository.findOne({
      where: { id: importBatchId, workspaceId: workspace.id },
    });

    if (!batch) {
      throw new BadRequestException('Import batch not found.');
    }

    const [
      createCount,
      updateCount,
      proposeCount,
      skipCount,
      rowsWithErrorsCount,
    ] = await Promise.all([
      this.importRowRepository.count({
        where: { importBatchId, matchAction: ImportRowMatchAction.CREATE },
      }),
      this.importRowRepository.count({
        where: { importBatchId, matchAction: ImportRowMatchAction.UPDATE },
      }),
      this.importRowRepository.count({
        where: { importBatchId, matchAction: ImportRowMatchAction.PROPOSE },
      }),
      this.importRowRepository.count({
        where: { importBatchId, matchAction: ImportRowMatchAction.SKIP },
      }),
      // TypeORM's Not(Equal({})) doesn't reliably express "not an empty
      // jsonb object" against Postgres - a raw text cast comparison is the
      // explicit, working form.
      this.importRowRepository
        .createQueryBuilder('row')
        .where('row.importBatchId = :importBatchId', { importBatchId })
        // Quoted explicitly: an unquoted camelCase identifier is folded to
        // lowercase by Postgres and the column is not found.
        .andWhere(`"row"."validationErrors"::text != '{}'`)
        .getCount(),
    ]);

    return {
      totalRows: batch.totalRows,
      createCount,
      updateCount,
      proposeCount,
      skipCount,
      rowsWithErrorsCount,
    };
  }
}
