import { zeroFillCounts } from 'src/engine/metadata-modules/ai/ai-trust-dashboard/utils/zero-fill-counts.util';

describe('zeroFillCounts', () => {
  it('emits an explicit zero for an expected key the aggregate returned no row for', () => {
    const result = zeroFillCounts([{ key: 'WEB_SEARCH', count: 4 }], [
      'CRM_RECORD',
      'WEB_SEARCH',
    ]);

    expect(result).toEqual([
      { key: 'CRM_RECORD', count: 0 },
      { key: 'WEB_SEARCH', count: 4 },
    ]);
  });

  it('preserves the expected key order regardless of aggregate row order', () => {
    const result = zeroFillCounts(
      [
        { key: 'OLDER_THAN_90_DAYS', count: 1 },
        { key: 'LAST_7_DAYS', count: 9 },
      ],
      ['LAST_7_DAYS', 'LAST_30_DAYS', 'OLDER_THAN_90_DAYS'],
    );

    expect(result.map((row) => row.key)).toEqual([
      'LAST_7_DAYS',
      'LAST_30_DAYS',
      'OLDER_THAN_90_DAYS',
    ]);
    expect(result.map((row) => row.count)).toEqual([9, 0, 1]);
  });

  it('keeps an unexpected key instead of dropping it', () => {
    // A source type present in the data but missing from the constant is a
    // real fact. Swallowing it would understate the total.
    const result = zeroFillCounts(
      [{ key: 'SOME_FUTURE_SOURCE', count: 3 }],
      ['CRM_RECORD'],
    );

    expect(result).toEqual([
      { key: 'CRM_RECORD', count: 0 },
      { key: 'SOME_FUTURE_SOURCE', count: 3 },
    ]);
  });

  it('sums duplicate keys rather than letting the last row win', () => {
    const result = zeroFillCounts(
      [
        { key: 'CRM_RECORD', count: 2 },
        { key: 'CRM_RECORD', count: 5 },
      ],
      ['CRM_RECORD'],
    );

    expect(result).toEqual([{ key: 'CRM_RECORD', count: 7 }]);
  });

  it('returns every expected key as zero when there is no data at all', () => {
    expect(zeroFillCounts([], ['A', 'B'])).toEqual([
      { key: 'A', count: 0 },
      { key: 'B', count: 0 },
    ]);
  });
});
