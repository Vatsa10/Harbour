import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { type Response } from 'express';
import { PermissionFlagType } from 'searm-shared/constants';
import { Repository } from 'typeorm';

import type { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { JwtAuthGuard } from 'src/engine/guards/jwt-auth.guard';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import { ImportRowStatus } from 'src/modules/guided-import/types/import-batch-status.type';

// A quote or newline in a user-supplied file name would otherwise break out of
// the Content-Disposition quoting.
const sanitizeContentDispositionFileName = (fileName: string): string =>
  fileName.replace(/[^\w.\- ]/g, '_');

@Controller('rest/import')
@UseGuards(
  JwtAuthGuard,
  WorkspaceAuthGuard,
  // The raw uploaded rows are the same data the mutation surface restricts;
  // ImportBatchResolver guards with IMPORT_CSV, so this door needs the same
  // lock or any workspace member can download any batch.
  SettingsPermissionGuard(PermissionFlagType.IMPORT_CSV),
)
export class ImportFailedRowsController {
  constructor(
    // Staging tables are core-schema platform infrastructure, not
    // workspace-object data, so the scoped repository wrapper doesn't apply.
    // eslint-disable-next-line searm/prefer-workspace-scoped-repository
    @InjectRepository(ImportBatchEntity)
    private readonly importBatchRepository: Repository<ImportBatchEntity>,
    // eslint-disable-next-line searm/prefer-workspace-scoped-repository
    @InjectRepository(ImportRowEntity)
    private readonly importRowRepository: Repository<ImportRowEntity>,
  ) {}

  @Get(':importBatchId/failed-rows.csv')
  async downloadFailedRows(
    @Param('importBatchId') importBatchId: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @Res() response: Response,
  ): Promise<void> {
    const batch = await this.importBatchRepository.findOne({
      where: { id: importBatchId, workspaceId: workspace.id },
    });

    if (!batch) {
      response.status(404).end();

      return;
    }

    const failedRows = await this.importRowRepository.find({
      where: { importBatchId, status: ImportRowStatus.FAILED },
      order: { rowNumber: 'ASC' },
    });

    response.setHeader('Content-Type', 'text/csv');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${sanitizeContentDispositionFileName(batch.fileName)}-failed-rows.csv"`,
    );

    const headers = new Set<string>();

    for (const row of failedRows) {
      Object.keys(row.rawData ?? {}).forEach((key) => headers.add(key));
    }

    const headerList = [...headers, 'Import Error'];

    response.write(headerList.map(this.escapeCsvCell).join(',') + '\n');

    for (const row of failedRows) {
      const cells = [...headers].map((header) =>
        this.escapeCsvCell(String((row.rawData ?? {})[header] ?? '')),
      );

      cells.push(this.escapeCsvCell(row.errorMessage ?? ''));
      response.write(cells.join(',') + '\n');
    }

    response.end();
  }

  private escapeCsvCell(value: string): string {
    // A cell opening with =, +, - or @ is executed as a formula by Excel and
    // Sheets when the downloaded file is opened. Prefix it so the cell stays
    // literal text.
    const neutralised = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

    if (
      neutralised.includes(',') ||
      neutralised.includes('"') ||
      neutralised.includes('\n')
    ) {
      return `"${neutralised.replace(/"/g, '""')}"`;
    }

    return neutralised;
  }
}
