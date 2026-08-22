import { Test, type TestingModule } from '@nestjs/testing';

import { KeyValuePairType } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { KeyValuePairService } from 'src/engine/core-modules/key-value-pair/key-value-pair.service';
import { IngestionSuppressionService } from 'src/modules/ingestion-noise-filter/services/ingestion-suppression.service';
import { INGESTION_SUPPRESSION_KEY } from 'src/modules/ingestion-noise-filter/types/ingestion-suppression.type';

describe('IngestionSuppressionService', () => {
  let service: IngestionSuppressionService;

  const keyValuePairService = { get: jest.fn(), set: jest.fn() };

  const withStored = (value: unknown) => {
    // KeyValuePairService.get() resolves an array of rows carrying `value`.
    keyValuePairService.get.mockResolvedValue([{ value }]);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    keyValuePairService.get.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IngestionSuppressionService,
        { provide: KeyValuePairService, useValue: keyValuePairService },
      ],
    }).compile();

    service = module.get(IngestionSuppressionService);
  });

  it('should return the empty suppression when nothing is stored', async () => {
    await expect(service.getSuppression('workspace-1')).resolves.toEqual({
      suppressedDomains: [],
      suppressedEmails: [],
    });
  });

  it('should normalise, dedupe and sort entries on write', async () => {
    const result = await service.setSuppression('workspace-1', {
      suppressedDomains: ['  WWW.Zoom.US ', 'https://acme.com/pricing', 'acme.com', 'not a domain'],
      suppressedEmails: ['  Ops@ACME.com', 'ops@acme.com', 'garbage'],
    });

    expect(result).toEqual({
      suppressedDomains: ['acme.com', 'zoom.us'],
      suppressedEmails: ['ops@acme.com'],
    });
    expect(keyValuePairService.set).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      userId: null,
      type: KeyValuePairType.CONFIG_VARIABLE,
      key: INGESTION_SUPPRESSION_KEY,
      value: result,
    });
  });

  it('should normalise unnormalised stored entries on read so they still match', async () => {
    withStored({
      suppressedDomains: ['  Vendor.IO '],
      suppressedEmails: [' Ops@ACME.com '],
      // A non-string written by an older client must not blow up the read.
      extra: 7,
    });

    const filter = await service.buildFilter('workspace-1');

    expect(filter.isSuppressed('someone@vendor.io')).toBe(true);
    expect(filter.isSuppressed('ops@acme.com')).toBe(true);
    expect(filter.isSuppressed('jane.doe@acme.com')).toBe(false);
  });

  it('should suppress built-in noise even with an empty tenant list', async () => {
    const filter = await service.buildFilter('workspace-1');

    expect(filter.isSuppressed('noreply@calendar.google.com')).toBe(true);
    expect(filter.isSuppressed('mailer-daemon@acme.com')).toBe(true);
    expect(filter.isSuppressed('Jane.Doe@Acme.com')).toBe(false);
  });
});
