import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { IdentityResolutionService } from 'src/modules/match-participant/services/identity-resolution.service';
import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import { ImportMatchResolutionService } from 'src/modules/guided-import/services/import-match-resolution.service';

describe('ImportMatchResolutionService', () => {
  let service: ImportMatchResolutionService;

  const importBatchRepository = { findOne: jest.fn() };
  const importRowRepository = { find: jest.fn(), save: jest.fn() };
  const identityResolutionService = {
    resolvePerson: jest.fn(),
    resolveCompany: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    importBatchRepository.findOne.mockResolvedValue({
      id: 'batch-1',
      workspaceId: 'workspace-1',
      objectNameSingular: 'person',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportMatchResolutionService,
        {
          provide: getRepositoryToken(ImportBatchEntity),
          useValue: importBatchRepository,
        },
        {
          provide: getRepositoryToken(ImportRowEntity),
          useValue: importRowRepository,
        },
        {
          provide: IdentityResolutionService,
          useValue: identityResolutionService,
        },
      ],
    }).compile();

    service = module.get<ImportMatchResolutionService>(
      ImportMatchResolutionService,
    );
  });

  it('should mark a row CREATE when there is no identity match', async () => {
    importRowRepository.find.mockResolvedValue([
      {
        id: 'row-1',
        mappedData: { emails: { primaryEmail: 'new@acme.com' } },
      },
    ]);
    identityResolutionService.resolvePerson.mockResolvedValue({
      kind: 'NONE',
    });

    await service.resolveBatch('batch-1');

    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'row-1',
        matchAction: 'CREATE',
        matchedRecordId: null,
      }),
    );
  });

  it('should mark a row UPDATE with the matched id on an EXACT match', async () => {
    importRowRepository.find.mockResolvedValue([
      {
        id: 'row-1',
        mappedData: { emails: { primaryEmail: 'jane@acme.com' } },
      },
    ]);
    identityResolutionService.resolvePerson.mockResolvedValue({
      kind: 'EXACT',
      recordId: 'person-1',
      matchedOn: 'email match',
    });

    await service.resolveBatch('batch-1');

    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'row-1',
        matchAction: 'UPDATE',
        matchedRecordId: 'person-1',
      }),
    );
  });

  it('should mark a row PROPOSE on a CANDIDATE match, never UPDATE silently', async () => {
    importRowRepository.find.mockResolvedValue([
      {
        id: 'row-1',
        mappedData: {
          emails: { primaryEmail: 'jane.doe@acme.com' },
          name: { firstName: 'Jane', lastName: 'Doe' },
        },
      },
    ]);
    identityResolutionService.resolvePerson.mockResolvedValue({
      kind: 'CANDIDATE',
      recordId: 'person-1',
      explanation: 'name and domain match, different email',
    });

    await service.resolveBatch('batch-1');

    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'row-1',
        matchAction: 'PROPOSE',
        matchedRecordId: 'person-1',
      }),
    );
  });

  it('should mark a row SKIP when it has no usable identity field at all', async () => {
    importRowRepository.find.mockResolvedValue([
      { id: 'row-1', mappedData: {} },
    ]);

    await service.resolveBatch('batch-1');

    expect(identityResolutionService.resolvePerson).not.toHaveBeenCalled();
    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'row-1', matchAction: 'CREATE' }),
    );
  });

  it('should default to CREATE for objects identity resolution does not cover', async () => {
    importBatchRepository.findOne.mockResolvedValue({
      id: 'batch-1',
      workspaceId: 'workspace-1',
      objectNameSingular: 'opportunity',
    });
    importRowRepository.find.mockResolvedValue([
      { id: 'row-1', mappedData: { name: 'New Deal' } },
    ]);

    await service.resolveBatch('batch-1');

    expect(identityResolutionService.resolvePerson).not.toHaveBeenCalled();
    expect(identityResolutionService.resolveCompany).not.toHaveBeenCalled();
    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'row-1', matchAction: 'CREATE' }),
    );
  });
});
