import { type AiTrustCountByKeyDTO } from 'src/engine/metadata-modules/ai/ai-trust-dashboard/dtos/ai-trust-dashboard.dto';

// A GROUP BY returns no row for a key with no matches, so a chart fed raw
// aggregate output silently drops categories. On this dashboard that is not a
// cosmetic problem: "0 facts from WEB_SEARCH" and "WEB_SEARCH not shown" look
// identical to a reader, and only one of them is a claim we can make.
//
// Keys outside `expectedKeys` are kept and appended after the expected ones —
// an unrecognized source type in the data is real and must not be swallowed
// by a stale constant in this file.
export const zeroFillCounts = (
  rows: readonly { key: string; count: number }[],
  expectedKeys: readonly string[],
): AiTrustCountByKeyDTO[] => {
  const countByKey = new Map<string, number>();

  for (const row of rows) {
    // Duplicate keys are summed rather than last-write-wins: two SQL rows
    // mapping to the same key (an unattributed fact and a NULL source type,
    // for instance) are two real facts.
    countByKey.set(row.key, (countByKey.get(row.key) ?? 0) + row.count);
  }

  const expected = expectedKeys.map((key) => ({
    key,
    count: countByKey.get(key) ?? 0,
  }));

  const unexpected = [...countByKey.entries()]
    .filter(([key]) => !expectedKeys.includes(key))
    .map(([key, count]) => ({ key, count }));

  return [...expected, ...unexpected];
};
