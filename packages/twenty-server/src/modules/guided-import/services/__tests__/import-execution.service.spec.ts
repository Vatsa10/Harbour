import { CreateRecordService } from 'src/engine/core-modules/record-crud/services/create-record.service';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { UpdateRecordService } from 'src/engine/core-modules/record-crud/services/update-record.service';
import { ProposalCreationService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-creation.service';
import { UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { type ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import { ImportExecutionService } from 'src/modules/guided-import/services/import-execution.service';

type StoredRow = Record<string, unknown> & { id: string; status: string };

// A real in-memory table rather than a `find` stub: the whole resumability
// claim is that the PENDING filter re-reads state written by earlier rows, so
// a mock returning a fixed array would double the very seam under test.
const buildRowTable = (rows: StoredRow[]) => {
  const store = new Map(rows.map((row) => [row.id, { ...row }]));

  const matches = (
    row: StoredRow,
    where: Record<string, unknown> | undefined,
  ) =>
    Object.entries(where ?? {}).every(
      ([key, value]) => (row as Record<string, unknown>)[key] === value,
    );

  return {
    store,
    find: jest.fn(
      async (options: {
        where?: Record<string, unknown>;
        take?: number;
      }) => {
        const found = [...store.values()]
          .filter((row) => matches(row, options.where))
          .sort(
            (a, b) => Number(a.rowNumber ?? 0) - Number(b.rowNumber ?? 0),
          );

        return options.take ? found.slice(0, options.take) : found;
      },
    ),
    count: jest.fn(
      async (options: { where?: Record<string, unknown> }) =>
        [...store.values()].filter((row) => matches(row, options.where)).length,
    ),
    save: jest.fn(async (entity: StoredRow) => {
      store.set(entity.id, { ...entity });

      return entity;
    }),
  };
};

describe('ImportExecutionService', () => {
  let service: ImportExecutionService;
  let importRowRepository: ReturnType<typeof buildRowTable>;

  const importBatchRepository = { findOne: jest.fn(), save: jest.fn() };
  const createRecordService = { execute: jest.fn() };
  const updateRecordService = { execute: jest.fn() };
  const findRecordsService = { execute: jest.fn() };
  const proposalCreationService = { createFromExtraction: jest.fn() };
  const userRoleService = { getRoleIdForUserWorkspace: jest.fn() };
  const workspaceCacheService = { getOrRecompute: jest.fn() };
  const userWorkspaceRepository = { findOne: jest.fn() };
  const userRepository = { findOne: jest.fn() };

  const buildRow = (overrides: Record<string, unknown> = {}): StoredRow => ({
    id: 'row-1',
    importBatchId: 'batch-1',
    rowNumber: 1,
    mappedData: { emails: { primaryEmail: 'jane@acme.com' } },
    matchAction: 'CREATE',
    matchedRecordId: null,
    validationErrors: {},
    status: 'PENDING',
    ...overrides,
  });

  const buildService = (rows: StoredRow[]) => {
    importRowRepository = buildRowTable(rows);

    return new ImportExecutionService(
      createRecordService as unknown as CreateRecordService,
      updateRecordService as unknown as UpdateRecordService,
      findRecordsService as unknown as FindRecordsService,
      proposalCreationService as unknown as ProposalCreationService,
      userRoleService as unknown as UserRoleService,
      workspaceCacheService as unknown as WorkspaceCacheService,
      userWorkspaceRepository as never,
      userRepository as never,
      importBatchRepository as never,
      importRowRepository as never,
    );
  };

  const execute = () =>
    service.executeBatch({
      workspaceId: 'workspace-1',
      importBatchId: 'batch-1',
    });

  beforeEach(() => {
    jest.clearAllMocks();
    importBatchRepository.findOne.mockResolvedValue({
      id: 'batch-1',
      workspaceId: 'workspace-1',
      objectNameSingular: 'person',
      createdByUserWorkspaceId: 'user-workspace-1',
      totalRows: 1,
      createdRowCount: 0,
      updatedRowCount: 0,
      proposedRowCount: 0,
      skippedRowCount: 0,
      failedRowCount: 0,
      processedRows: 0,
    });
    importBatchRepository.save.mockImplementation(async (entity) => entity);
    proposalCreationService.createFromExtraction.mockResolvedValue({
      proposalId: 'proposal-1',
      itemIds: ['item-1'],
    });
    userWorkspaceRepository.findOne.mockResolvedValue({
      id: 'user-workspace-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    userRepository.findOne.mockResolvedValue({
      id: 'user-1',
      firstName: 'Jane',
      lastName: 'Doe',
      // fromUserEntityToFlat is the real utility here, not a mock — it
      // serializes these, so omitting them would only fail at runtime.
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    workspaceCacheService.getOrRecompute.mockResolvedValue({
      flatWorkspaceMemberMaps: {
        idByUserId: { 'user-1': 'workspace-member-1' },
        byId: { 'workspace-member-1': { id: 'workspace-member-1' } },
      },
    });
    userRoleService.getRoleIdForUserWorkspace.mockResolvedValue('role-1');
    createRecordService.execute.mockResolvedValue({
      success: true,
      message: 'created',
      result: { record: { id: 'person-1' } },
    });
    service = buildService([buildRow()]);
  });

  it('should create a record for a CREATE row and mark it PROCESSED', async () => {
    await execute();

    expect(createRecordService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        objectName: 'person',
        objectRecord: { emails: { primaryEmail: 'jane@acme.com' } },
      }),
    );
    expect(importRowRepository.store.get('row-1')?.status).toBe('PROCESSED');
  });

  // C7: the importing user's own role must gate the write, and the record
  // must be attributed to them, not to SYSTEM.
  it("should write under the importing user's role and name them as the actor", async () => {
    await execute();

    expect(userRoleService.getRoleIdForUserWorkspace).toHaveBeenCalledWith({
      userWorkspaceId: 'user-workspace-1',
      workspaceId: 'workspace-1',
    });
    expect(createRecordService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        rolePermissionConfig: { unionOf: ['role-1'] },
        createdBy: expect.objectContaining({ name: 'Jane Doe' }),
      }),
    );
  });

  it('should refuse to run a batch with no recorded importing user', async () => {
    importBatchRepository.findOne.mockResolvedValue({
      id: 'batch-1',
      workspaceId: 'workspace-1',
      objectNameSingular: 'person',
      createdByUserWorkspaceId: null,
      totalRows: 1,
    });

    await expect(execute()).rejects.toThrow('createdByUserWorkspaceId');
    expect(createRecordService.execute).not.toHaveBeenCalled();
  });

  it('should surface a permission refusal as a FAILED row', async () => {
    createRecordService.execute.mockResolvedValue({
      success: false,
      message: 'Permission denied',
      error: 'You do not have permission to write person.jobTitle',
    });

    await execute();

    const row = importRowRepository.store.get('row-1');

    expect(row?.status).toBe('FAILED');
    expect(row?.errorMessage).toContain('permission');
  });

  it('should update a record for an UPDATE row using matchedRecordId', async () => {
    service = buildService([
      buildRow({ matchAction: 'UPDATE', matchedRecordId: 'person-1' }),
    ]);
    updateRecordService.execute.mockResolvedValue({
      success: true,
      message: 'updated',
    });

    await execute();

    expect(updateRecordService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        objectName: 'person',
        objectRecordId: 'person-1',
        updatedBy: expect.objectContaining({ name: 'Jane Doe' }),
      }),
    );
    expect(importRowRepository.store.get('row-1')?.status).toBe('PROCESSED');
  });

  it('should create a proposal for a PROPOSE row rather than writing directly', async () => {
    service = buildService([
      buildRow({ matchAction: 'PROPOSE', matchedRecordId: 'person-1' }),
    ]);
    findRecordsService.execute.mockResolvedValue({
      success: true,
      message: 'ok',
      result: {
        records: [
          { id: 'person-1', emails: { primaryEmail: 'old@acme.com' } },
        ],
      },
    });

    await execute();

    expect(createRecordService.execute).not.toHaveBeenCalled();
    expect(updateRecordService.execute).not.toHaveBeenCalled();
    expect(proposalCreationService.createFromExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        sourceKey: 'import:batch-1:1',
      }),
    );
    expect(importRowRepository.store.get('row-1')?.status).toBe('PROCESSED');
  });

  it('should mark a row with validation errors FAILED without attempting a write', async () => {
    service = buildService([
      buildRow({ validationErrors: { emails: 'Emails is required.' } }),
    ]);

    await execute();

    expect(createRecordService.execute).not.toHaveBeenCalled();
    expect(importRowRepository.store.get('row-1')?.errorMessage).toContain(
      'validation',
    );
  });

  it('should mark a SKIP row PROCESSED without writing', async () => {
    service = buildService([buildRow({ matchAction: 'SKIP' })]);

    await execute();

    expect(createRecordService.execute).not.toHaveBeenCalled();
    expect(importRowRepository.store.get('row-1')?.status).toBe('PROCESSED');
  });

  it('should isolate one row failure from the rest of the batch', async () => {
    service = buildService([
      buildRow({ id: 'row-1', rowNumber: 1 }),
      buildRow({ id: 'row-2', rowNumber: 2 }),
    ]);
    createRecordService.execute
      .mockRejectedValueOnce(new Error('duplicate key'))
      .mockResolvedValueOnce({
        success: true,
        message: 'created',
        result: { record: { id: 'person-2' } },
      });

    await execute();

    expect(importRowRepository.store.get('row-1')).toMatchObject({
      status: 'FAILED',
      errorMessage: 'duplicate key',
    });
    expect(importRowRepository.store.get('row-2')?.status).toBe('PROCESSED');
  });

  // The resumability test the controller asked for: the run is genuinely
  // interrupted (the process "crashes" mid-batch by throwing out of the row
  // loop), then the SAME service instance and the SAME table are re-run.
  // Rows already durably PROCESSED must not be written a second time.
  it('should resume an interrupted run without re-writing already processed rows', async () => {
    service = buildService([
      buildRow({ id: 'row-1', rowNumber: 1 }),
      buildRow({ id: 'row-2', rowNumber: 2 }),
      buildRow({ id: 'row-3', rowNumber: 3 }),
    ]);

    // First chunk yields row 1 only (as a smaller take would); the worker is
    // then killed while claiming the next chunk. Row 1 is durably PROCESSED,
    // rows 2-3 are still PENDING.
    const realFind = importRowRepository.find.getMockImplementation();

    importRowRepository.find.mockImplementationOnce(async () => [
      importRowRepository.store.get('row-1') as never,
    ]);
    importRowRepository.find.mockImplementationOnce(async () => {
      throw new Error('worker killed');
    });

    await expect(execute()).rejects.toThrow('worker killed');

    importRowRepository.find.mockImplementation(realFind as never);

    expect(createRecordService.execute).toHaveBeenCalledTimes(1);
    expect(importRowRepository.store.get('row-1')?.status).toBe('PROCESSED');
    expect(importRowRepository.store.get('row-2')?.status).toBe('PENDING');

    createRecordService.execute.mockClear();

    // Retry, exactly as BullMQ would re-run the job.
    await execute();

    // Only rows 2 and 3 are re-attempted — row 1 is never written twice.
    expect(createRecordService.execute).toHaveBeenCalledTimes(2);
    expect(
      [...importRowRepository.store.values()].every(
        (row) => row.status === 'PROCESSED',
      ),
    ).toBe(true);
  });

  it('should mark the batch COMPLETED once every row has been processed', async () => {
    await execute();

    expect(importBatchRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'batch-1',
        status: 'COMPLETED',
        createdRowCount: 1,
        processedRows: 1,
      }),
    );
  });

  it('should keep the batch RUNNING while rows remain PENDING', async () => {
    service = buildService([
      buildRow({ id: 'row-1', rowNumber: 1 }),
      buildRow({ id: 'row-2', rowNumber: 2, status: 'PENDING' }),
    ]);
    // Simulate a row the loop cannot claim (left PENDING by a concurrent
    // worker): the batch must not be reported COMPLETED.
    importRowRepository.find.mockImplementationOnce(async () => [
      importRowRepository.store.get('row-1') as ImportRowEntity & StoredRow,
    ]);
    importRowRepository.find.mockImplementationOnce(async () => []);

    await execute();

    expect(importBatchRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'batch-1', status: 'RUNNING' }),
    );
  });
});
