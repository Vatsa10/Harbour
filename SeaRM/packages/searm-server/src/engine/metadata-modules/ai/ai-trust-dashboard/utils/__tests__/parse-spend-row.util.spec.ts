import { parseSpendRow } from 'src/engine/metadata-modules/ai/ai-trust-dashboard/utils/parse-spend-row.util';

describe('parseSpendRow', () => {
  it('keeps a bigint credit sum exact as a string while deriving the display float', () => {
    // node-postgres returns SUM(bigint) as a string. Number() on this value
    // loses the last digits, so the string must survive untouched.
    const exact = '9007199254740993';

    const result = parseSpendRow({
      periodStart: new Date('2026-08-01T00:00:00.000Z'),
      runCount: '3',
      inputTokens: '1000',
      outputTokens: '2000',
      creditsUsedMicro: exact,
    });

    expect(result.creditsUsedMicro).toBe(exact);
    expect(result.creditsUsed).toBeCloseTo(9007199254.740993, 3);
  });

  it('divides micro-credits into credits', () => {
    const result = parseSpendRow({
      periodStart: '2026-08-01T00:00:00.000Z',
      runCount: 1,
      inputTokens: 0,
      outputTokens: 0,
      creditsUsedMicro: '2500000',
    });

    expect(result.creditsUsed).toBe(2.5);
  });

  it('treats a NULL sum as zero rather than NaN', () => {
    const result = parseSpendRow({
      periodStart: '2026-08-01T00:00:00.000Z',
      runCount: null,
      inputTokens: null,
      outputTokens: null,
      creditsUsedMicro: null,
    });

    expect(result.runCount).toBe(0);
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.creditsUsedMicro).toBe('0');
    expect(result.creditsUsed).toBe(0);
  });

  it('coerces a string period start into a Date', () => {
    const result = parseSpendRow({
      periodStart: '2026-08-01T00:00:00.000Z',
      runCount: '0',
      inputTokens: '0',
      outputTokens: '0',
      creditsUsedMicro: '0',
    });

    expect(result.periodStart).toBeInstanceOf(Date);
    expect(result.periodStart.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('sums token counts past the 32-bit signed range without truncating', () => {
    const result = parseSpendRow({
      periodStart: '2026-08-01T00:00:00.000Z',
      runCount: '10',
      inputTokens: '3000000000',
      outputTokens: '0',
      creditsUsedMicro: '0',
    });

    expect(result.inputTokens).toBe(3_000_000_000);
  });
});
