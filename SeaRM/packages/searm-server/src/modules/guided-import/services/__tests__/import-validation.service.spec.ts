import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import { ImportValidationService } from 'src/modules/guided-import/services/import-validation.service';

describe('ImportValidationService', () => {
  let service: ImportValidationService;

  const importBatchRepository = { findOne: jest.fn() };
  const importRowRepository = { find: jest.fn(), save: jest.fn() };
  const flatEntityMapsCacheService = {
    getOrRecomputeManyOrAllFlatEntityMaps: jest.fn(),
  };

  const personObject = {
    id: 'object-1',
    nameSingular: 'person',
    fieldIds: ['field-1', 'field-2'],
  };
  const jobTitleField = {
    id: 'field-1',
    objectMetadataId: 'object-1',
    name: 'jobTitle',
    label: 'Job Title',
    type: 'TEXT',
    isNullable: true,
    isCustom: false,
  };
  const emailsField = {
    id: 'field-2',
    objectMetadataId: 'object-1',
    name: 'emails',
    label: 'Emails',
    type: 'EMAILS',
    isNullable: false,
    isCustom: false,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    importBatchRepository.findOne.mockResolvedValue({
      id: 'batch-1',
      workspaceId: 'workspace-1',
      objectNameSingular: 'person',
    });
    flatEntityMapsCacheService.getOrRecomputeManyOrAllFlatEntityMaps.mockResolvedValue(
      {
        flatObjectMetadataMaps: {
          byUniversalIdentifier: { 'object-1': personObject },
        },
        flatFieldMetadataMaps: {
          byUniversalIdentifier: {
            'field-1': jobTitleField,
            'field-2': emailsField,
          },
          universalIdentifierById: {
            'field-1': 'field-1',
            'field-2': 'field-2',
          },
        },
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportValidationService,
        {
          provide: getRepositoryToken(ImportBatchEntity),
          useValue: importBatchRepository,
        },
        {
          provide: getRepositoryToken(ImportRowEntity),
          useValue: importRowRepository,
        },
        {
          provide: WorkspaceManyOrAllFlatEntityMapsCacheService,
          useValue: flatEntityMapsCacheService,
        },
      ],
    }).compile();

    service = module.get<ImportValidationService>(ImportValidationService);
  });

  it('should mark a valid row with an empty validationErrors object', async () => {
    importRowRepository.find.mockResolvedValue([
      {
        id: 'row-1',
        matchAction: 'CREATE',
        mappedData: { emails: { primaryEmail: 'jane@acme.com' }, jobTitle: 'VP' },
      },
    ]);

    await service.validateBatch('batch-1', 'workspace-1');

    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'row-1', validationErrors: {} }),
    );
  });

  it('should flag a missing required field on a CREATE row', async () => {
    importRowRepository.find.mockResolvedValue([
      { id: 'row-1', matchAction: 'CREATE', mappedData: { jobTitle: 'VP' } },
    ]);

    await service.validateBatch('batch-1', 'workspace-1');

    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'row-1',
        validationErrors: { emails: expect.stringContaining('required') },
      }),
    );
  });

  it('should not require a field to be present on an UPDATE row', async () => {
    importRowRepository.find.mockResolvedValue([
      {
        id: 'row-1',
        matchAction: 'UPDATE',
        matchedRecordId: 'person-1',
        mappedData: { jobTitle: 'VP' },
      },
    ]);

    await service.validateBatch('batch-1', 'workspace-1');

    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'row-1', validationErrors: {} }),
    );
  });

  it('should skip validation for a SKIP row', async () => {
    importRowRepository.find.mockResolvedValue([
      { id: 'row-1', matchAction: 'SKIP', mappedData: {} },
    ]);

    await service.validateBatch('batch-1', 'workspace-1');

    expect(importRowRepository.save).not.toHaveBeenCalled();
  });
});
