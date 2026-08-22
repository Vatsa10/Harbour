import { isDefined } from 'searm-shared/utils';

import { type CreateRecordService } from 'src/engine/core-modules/record-crud/services/create-record.service';
import { type FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { type UpdateRecordService } from 'src/engine/core-modules/record-crud/services/update-record.service';
import { type ProposalCreationService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-creation.service';
import { type UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { ImportExecutionService } from 'src/modules/guided-import/services/import-execution.service';

// Match resolution runs once, up front, against records that existed before
// the import started. Two rows naming the same *new* company therefore both
// resolve to CREATE. Without intra-import dedup that CSV yields two companies
// — the correctness bug this file exists to keep fixed.

type StoredRow = Record<string, unknown> & { id: string; status: string };

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
    // Models the atomic claim rather than returning a fixed array: the whole
    // dedup claim depends on rows being processed in order across chunks.
    query: jest.fn(async (_sql: string, parameters: unknown[]) => {
      const [inProgressStatus, importBatchId, pendingStatus, leaseMinutes, limit] =
        parameters as [string, string, string, string, number];
      const leaseCutoff = Date.now() - Number(leaseMinutes) * 60 * 1000;

      const claimable = [...store.values()]
        .filter(
          (row) =>
            row.importBatchId === importBatchId &&
            (row.status === pendingStatus ||
              (row.status === inProgressStatus &&
                isDefined(row.leasedAt) &&
                new Date(row.leasedAt as string | Date).getTime() <
                  leaseCutoff)),
        )
        .sort((a, b) => Number(a.rowNumber ?? 0) - Number(b.rowNumber ?? 0))
        .slice(0, limit);

      return claimable.map((row) => {
        const claimed = {
          ...row,
          status: inProgressStatus,
          leasedAt: new Date(),
        } as StoredRow;

        store.set(claimed.id, claimed);

        return claimed;
      });
    }),
    count: jest.fn(
      async (options: {
        where?: Record<string, unknown> | Record<string, unknown>[];
      }) => {
        const clauses = Array.isArray(options.where)
          ? options.where
          : [options.where];

        return [...store.values()].filter((row) =>
          clauses.some((clause) => matches(row, clause)),
        ).length;
      },
    ),
    save: jest.fn(async (entity: StoredRow) => {
      store.set(entity.id, { ...entity });

      return entity;
    }),
  };
};

describe('ImportExecutionService — intra-import Create to Update promotion', () => {
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

  const companyRow = (
    id: string,
    rowNumber: number,
    mappedData: Record<string, unknown>,
  ): StoredRow => ({
    id,
    importBatchId: 'batch-1',
    rowNumber,
    mappedData,
    matchAction: 'CREATE',
    matchedRecordId: null,
    validationErrors: {},
    status: 'PENDING',
  });

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
      objectNameSingular: 'company',
      createdByUserWorkspaceId: 'user-workspace-1',
      totalRows: 2,
      createdRowCount: 0,
      updatedRowCount: 0,
      proposedRowCount: 0,
      skippedRowCount: 0,
      failedRowCount: 0,
      processedRows: 0,
    });
    importBatchRepository.save.mockImplementation(async (entity) => entity);
    userWorkspaceRepository.findOne.mockResolvedValue({
      id: 'user-workspace-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    userRepository.findOne.mockResolvedValue({
      id: 'user-1',
      firstName: 'Jane',
      lastName: 'Doe',
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

    let createdCount = 0;

    createRecordService.execute.mockImplementation(async () => {
      createdCount += 1;

      return {
        success: true,
        message: 'created',
        result: { record: { id: `company-${createdCount}` } },
      };
    });
    updateRecordService.execute.mockResolvedValue({
      success: true,
      message: 'updated',
      result: { record: { id: 'company-1' } },
    });
  });

  it('should create one company for a CSV naming the same new company twice', async () => {
    service = buildService([
      companyRow('row-1', 1, {
        name: 'Acme Inc',
        domainName: { primaryLinkUrl: 'https://acme.com' },
      }),
      companyRow('row-2', 2, {
        name: 'Acme Inc',
        // Same company, written differently in the file — the identity key
        // normalises scheme, trailing slash and case.
        domainName: { primaryLinkUrl: 'http://ACME.com/' },
        employees: 40,
      }),
    ]);

    await execute();

    expect(createRecordService.execute).toHaveBeenCalledTimes(1);
    expect(updateRecordService.execute).toHaveBeenCalledTimes(1);
    // The second row updates the record the first row just created, so the
    // import leaves exactly one Acme company behind.
    expect(updateRecordService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        objectName: 'company',
        objectRecordId: 'company-1',
        objectRecord: expect.objectContaining({ employees: 40 }),
      }),
    );

    const saveCalls = importBatchRepository.save.mock.calls;
    const savedBatch = saveCalls[saveCalls.length - 1][0];

    expect(savedBatch.createdRowCount).toBe(1);
    expect(savedBatch.updatedRowCount).toBe(1);
    expect(importRowRepository.store.get('row-2')?.matchedRecordId).toBe(
      'company-1',
    );
  });

  it('should still create two companies for two genuinely different rows', async () => {
    service = buildService([
      companyRow('row-1', 1, {
        name: 'Acme Inc',
        domainName: { primaryLinkUrl: 'https://acme.com' },
      }),
      companyRow('row-2', 2, {
        name: 'Globex',
        domainName: { primaryLinkUrl: 'https://globex.com' },
      }),
    ]);

    await execute();

    expect(createRecordService.execute).toHaveBeenCalledTimes(2);
    expect(updateRecordService.execute).not.toHaveBeenCalled();
  });

  it('should not dedup rows that carry no identity signal at all', async () => {
    service = buildService([
      companyRow('row-1', 1, { employees: 10 }),
      companyRow('row-2', 2, { employees: 20 }),
    ]);

    await execute();

    expect(createRecordService.execute).toHaveBeenCalledTimes(2);
    expect(updateRecordService.execute).not.toHaveBeenCalled();
  });

  it('should dedup people on their primary email within one import', async () => {
    importBatchRepository.findOne.mockResolvedValue({
      id: 'batch-1',
      workspaceId: 'workspace-1',
      objectNameSingular: 'person',
      createdByUserWorkspaceId: 'user-workspace-1',
      totalRows: 2,
      createdRowCount: 0,
      updatedRowCount: 0,
      proposedRowCount: 0,
      skippedRowCount: 0,
      failedRowCount: 0,
      processedRows: 0,
    });

    service = buildService([
      companyRow('row-1', 1, { emails: { primaryEmail: 'jane@acme.com' } }),
      companyRow('row-2', 2, { emails: { primaryEmail: 'JANE@acme.com ' } }),
    ]);

    await execute();

    expect(createRecordService.execute).toHaveBeenCalledTimes(1);
    expect(updateRecordService.execute).toHaveBeenCalledTimes(1);
  });

});
