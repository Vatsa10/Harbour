import { Test, type TestingModule } from '@nestjs/testing';

import { CommonApiContextBuilderService } from 'src/engine/core-modules/record-crud/services/common-api-context-builder.service';
import { CommonFindManyQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-find-many-query-runner.service';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';

describe('FindRecordsService hasMore', () => {
  let service: FindRecordsService;

  const commonFindManyRunner = { execute: jest.fn() };
  const commonApiContextBuilder = {
    build: jest.fn().mockResolvedValue({
      queryRunnerContext: {},
      selectedFields: { id: true },
      flatObjectMetadata: {},
      flatFieldMetadataMaps: {},
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    commonApiContextBuilder.build.mockResolvedValue({
      queryRunnerContext: {},
      selectedFields: { id: true },
      flatObjectMetadata: {},
      flatFieldMetadataMaps: {},
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FindRecordsService,
        {
          provide: CommonFindManyQueryRunnerService,
          useValue: commonFindManyRunner,
        },
        {
          provide: CommonApiContextBuilderService,
          useValue: commonApiContextBuilder,
        },
      ],
    }).compile();

    service = module.get<FindRecordsService>(FindRecordsService);
  });

  it('should set hasMore true when more records exist beyond this page', async () => {
    commonFindManyRunner.execute.mockResolvedValue({
      results: {
        records: [{ id: 'a' }, { id: 'b' }],
        totalCount: 10,
      },
    });

    const output = await service.execute({
      objectName: 'person',
      limit: 2,
      offset: 0,
      shouldBuildEffectiveSelectFields: false,
      authContext: {} as never,
      rolePermissionConfig: {} as never,
    });

    expect(output.result?.hasMore).toBe(true);
  });

  it('should set hasMore false on the last page', async () => {
    commonFindManyRunner.execute.mockResolvedValue({
      results: {
        records: [{ id: 'i' }, { id: 'j' }],
        totalCount: 10,
      },
    });

    const output = await service.execute({
      objectName: 'person',
      limit: 2,
      offset: 8,
      shouldBuildEffectiveSelectFields: false,
      authContext: {} as never,
      rolePermissionConfig: {} as never,
    });

    expect(output.result?.hasMore).toBe(false);
  });

  it('should set hasMore false when offset + records.length exactly equals count (real seam: boundary arithmetic)', async () => {
    commonFindManyRunner.execute.mockResolvedValue({
      results: {
        records: [{ id: 'k' }],
        totalCount: 9,
      },
    });

    const output = await service.execute({
      objectName: 'person',
      limit: 1,
      offset: 8,
      shouldBuildEffectiveSelectFields: false,
      authContext: {} as never,
      rolePermissionConfig: {} as never,
    });

    expect(output.result?.hasMore).toBe(false);
    expect(output.result?.count).toBe(9);
  });
});
