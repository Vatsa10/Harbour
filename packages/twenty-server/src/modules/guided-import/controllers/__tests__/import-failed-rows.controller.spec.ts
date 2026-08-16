import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import { ImportFailedRowsController } from 'src/modules/guided-import/controllers/import-failed-rows.controller';
import { JwtAuthGuard } from 'src/engine/guards/jwt-auth.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';
import { PermissionFlagType } from 'twenty-shared/constants';
import { type CanActivate, type Type } from '@nestjs/common';

describe('ImportFailedRowsController', () => {
  let controller: ImportFailedRowsController;

  const importBatchRepository = { findOne: jest.fn() };
  const importRowRepository = { find: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportFailedRowsController,
        {
          provide: getRepositoryToken(ImportBatchEntity),
          useValue: importBatchRepository,
        },
        {
          provide: getRepositoryToken(ImportRowEntity),
          useValue: importRowRepository,
        },
        // SettingsPermissionGuard(IMPORT_CSV) is constructed at class-decoration
        // time and injects this; the guard itself is stubbed below.
        {
          provide: PermissionsService,
          useValue: { userHasWorkspaceSettingPermission: jest.fn() },
        },
      ],
    })
      // Class-level @UseGuards references real guards whose own
      // dependencies (token services, cache storage) are irrelevant to this
      // controller's behavior - override them the same way
      // mcp-core.controller.spec.ts does rather than wiring real auth.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(WorkspaceAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get<ImportFailedRowsController>(
      ImportFailedRowsController,
    );
  });

  it('should stream a CSV with the original headers plus an Import Error column', async () => {
    importBatchRepository.findOne.mockResolvedValue({
      id: 'batch-1',
      workspaceId: 'workspace-1',
      fileName: 'contacts.csv',
    });
    importRowRepository.find.mockResolvedValue([
      {
        rawData: { Email: 'bad-email' },
        errorMessage: 'Emails is required.',
      },
    ]);

    const response = {
      setHeader: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    };

    await controller.downloadFailedRows(
      'batch-1',
      { id: 'workspace-1' } as never,
      response as never,
    );

    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/csv',
    );
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('Email'),
    );
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('Import Error'),
    );
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('bad-email'),
    );
    expect(response.end).toHaveBeenCalled();
  });

  it('should 404 when the batch does not exist or belongs to another workspace', async () => {
    importBatchRepository.findOne.mockResolvedValue(null);

    const response = {
      status: jest.fn().mockReturnThis(),
      end: jest.fn(),
      setHeader: jest.fn(),
      write: jest.fn(),
    };

    await controller.downloadFailedRows(
      'batch-404',
      { id: 'workspace-1' } as never,
      response as never,
    );

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.setHeader).not.toHaveBeenCalled();
  });

  // I5: the raw uploaded rows are the same data ImportBatchResolver restricts
  // with IMPORT_CSV. Without a settings guard on this controller any
  // authenticated workspace member could download any batch's file contents.
  // The guard is a class-level decorator, so its presence shows up as a hard
  // dependency on PermissionsService: drop the guard and this module compiles.
  it('should require the settings-permission guard dependency', async () => {
    await expect(
      Test.createTestingModule({
        providers: [
          ImportFailedRowsController,
          {
            provide: getRepositoryToken(ImportBatchEntity),
            useValue: importBatchRepository,
          },
          {
            provide: getRepositoryToken(ImportRowEntity),
            useValue: importRowRepository,
          },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({ canActivate: jest.fn().mockReturnValue(true) })
        .overrideGuard(WorkspaceAuthGuard)
        .useValue({ canActivate: jest.fn().mockReturnValue(true) })
        .compile(),
    ).rejects.toThrow('PermissionsService');
  });
});
