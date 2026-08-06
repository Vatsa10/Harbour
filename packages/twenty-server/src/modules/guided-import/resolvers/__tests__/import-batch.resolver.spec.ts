import { ImportBatchResolver } from 'src/modules/guided-import/resolvers/import-batch.resolver';

// Instantiated directly (not via Test.createTestingModule) because the
// resolver is class-decorated with SettingsPermissionGuard, which Nest's
// TestingModule eagerly tries to resolve dependencies for even though guards
// never run when a resolver method is invoked directly, same pattern as
// workspace-setup-chat.resolver.spec.ts.
describe('ImportBatchResolver', () => {
  let resolver: ImportBatchResolver;

  const importBatchRepository = { save: jest.fn(), findOne: jest.fn() };
  const importRowRepository = { insert: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    importBatchRepository.save.mockImplementation(async (entity) => ({
      ...entity,
      id: 'batch-1',
    }));

    resolver = new ImportBatchResolver(
      importBatchRepository as never,
      importRowRepository as never,
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
