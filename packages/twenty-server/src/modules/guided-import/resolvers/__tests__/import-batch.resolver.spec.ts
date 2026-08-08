import { ImportBatchResolver } from 'src/modules/guided-import/resolvers/import-batch.resolver';

// Instantiated directly (not via Test.createTestingModule) because the
// resolver is class-decorated with SettingsPermissionGuard, which Nest's
// TestingModule eagerly tries to resolve dependencies for even though guards
// never run when a resolver method is invoked directly, same pattern as
// workspace-setup-chat.resolver.spec.ts.
describe('ImportBatchResolver', () => {
  let resolver: ImportBatchResolver;

  const importBatchRepository = { save: jest.fn(), findOne: jest.fn() };
  const importRowRepository = { insert: jest.fn(), count: jest.fn() };
  const matchResolutionService = { resolveBatch: jest.fn() };
  const validationService = { validateBatch: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    importBatchRepository.save.mockImplementation(async (entity) => ({
      ...entity,
      id: 'batch-1',
    }));

    resolver = new ImportBatchResolver(
      importBatchRepository as never,
      importRowRepository as never,
      matchResolutionService as never,
      validationService as never,
    );
  });

  it('should create a PENDING batch and stage every row', async () => {
    const result = await resolver.createImportBatch(
      {
        objectNameSingular: 'person',
        fileName: 'contacts.csv',
        rawRows: [{ Email: 'a@example.com' }, { Email: 'b@example.com' }],
        mappedRows: [
          { emails: { primaryEmail: 'a@example.com' } },
          { emails: { primaryEmail: 'b@example.com' } },
        ],
        columnMapping: { Email: 'emails.primaryEmail' },
      },
      { id: 'workspace-1' } as never,
      'user-workspace-1',
    );

    expect(importBatchRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        objectNameSingular: 'person',
        fileName: 'contacts.csv',
        status: 'PENDING',
        totalRows: 2,
        createdByUserWorkspaceId: 'user-workspace-1',
      }),
    );
    expect(importRowRepository.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        importBatchId: 'batch-1',
        rowNumber: 1,
        rawData: { Email: 'a@example.com' },
        mappedData: { emails: { primaryEmail: 'a@example.com' } },
      }),
      expect.objectContaining({
        importBatchId: 'batch-1',
        rowNumber: 2,
        rawData: { Email: 'b@example.com' },
        mappedData: { emails: { primaryEmail: 'b@example.com' } },
      }),
    ]);
    expect(result.id).toBe('batch-1');
    expect(result.totalRows).toBe(2);
  });

  it('should reject an empty file', async () => {
    await expect(
      resolver.createImportBatch(
        {
          objectNameSingular: 'person',
          fileName: 'empty.csv',
          rawRows: [],
          mappedRows: [],
          columnMapping: {},
        },
        { id: 'workspace-1' } as never,
        'user-workspace-1',
      ),
    ).rejects.toThrow();

    expect(importBatchRepository.save).not.toHaveBeenCalled();
  });

  it('should reject mismatched rawRows/mappedRows lengths', async () => {
    await expect(
      resolver.createImportBatch(
        {
          objectNameSingular: 'person',
          fileName: 'contacts.csv',
          rawRows: [{ Email: 'a@example.com' }],
          mappedRows: [],
          columnMapping: {},
        },
        { id: 'workspace-1' } as never,
        'user-workspace-1',
      ),
    ).rejects.toThrow();

    expect(importBatchRepository.save).not.toHaveBeenCalled();
  });
});

describe('prepareImportBatch', () => {
  const importBatchRepository = { save: jest.fn(), findOne: jest.fn() };
  const importRowRepository = { insert: jest.fn(), count: jest.fn() };
  const matchResolutionService = { resolveBatch: jest.fn() };
  const validationService = { validateBatch: jest.fn() };
  let resolver: ImportBatchResolver;

  beforeEach(() => {
    jest.clearAllMocks();
    resolver = new ImportBatchResolver(
      importBatchRepository as never,
      importRowRepository as never,
      matchResolutionService as never,
      validationService as never,
    );
  });

  it('should run match resolution then validation and mark the batch READY', async () => {
    importBatchRepository.findOne.mockResolvedValue({
      id: 'batch-1',
      workspaceId: 'workspace-1',
      status: 'PENDING',
    });
    importBatchRepository.save.mockImplementation(async (entity) => entity);

    await resolver.prepareImportBatch('batch-1', { id: 'workspace-1' } as never);

    expect(matchResolutionService.resolveBatch).toHaveBeenCalledWith(
      'batch-1',
    );
    expect(validationService.validateBatch).toHaveBeenCalledWith('batch-1');
    expect(importBatchRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'batch-1', status: 'READY' }),
    );
  });

  it('should reject a missing batch', async () => {
    importBatchRepository.findOne.mockResolvedValue(null);

    await expect(
      resolver.prepareImportBatch('batch-404', {
        id: 'workspace-1',
      } as never),
    ).rejects.toThrow();
  });
});

describe('importBatchPreview', () => {
  const importBatchRepository = { save: jest.fn(), findOne: jest.fn() };
  const importRowRepository = {
    insert: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const matchResolutionService = { resolveBatch: jest.fn() };
  const validationService = { validateBatch: jest.fn() };
  let resolver: ImportBatchResolver;

  beforeEach(() => {
    jest.clearAllMocks();
    resolver = new ImportBatchResolver(
      importBatchRepository as never,
      importRowRepository as never,
      matchResolutionService as never,
      validationService as never,
    );
  });

  it('should count rows by matchAction and validation status', async () => {
    importRowRepository.count = jest.fn(
      ({ where }: { where: Record<string, unknown> }) => {
        if (where.matchAction === 'CREATE') return Promise.resolve(3);
        if (where.matchAction === 'UPDATE') return Promise.resolve(1);
        if (where.matchAction === 'PROPOSE') return Promise.resolve(1);
        if (where.matchAction === 'SKIP') return Promise.resolve(0);

        return Promise.resolve(0);
      },
    );
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(2),
    };

    importRowRepository.createQueryBuilder.mockReturnValue(queryBuilder);
    importBatchRepository.findOne.mockResolvedValue({
      id: 'batch-1',
      workspaceId: 'workspace-1',
      totalRows: 5,
    });

    const preview = await resolver.importBatchPreview(
      'batch-1',
      { id: 'workspace-1' } as never,
    );

    expect(preview).toEqual({
      totalRows: 5,
      createCount: 3,
      updateCount: 1,
      proposeCount: 1,
      skipCount: 0,
      rowsWithErrorsCount: 2,
    });
  });

  it('should reject a missing batch', async () => {
    importBatchRepository.findOne.mockResolvedValue(null);

    await expect(
      resolver.importBatchPreview('batch-404', {
        id: 'workspace-1',
      } as never),
    ).rejects.toThrow();
  });
});
