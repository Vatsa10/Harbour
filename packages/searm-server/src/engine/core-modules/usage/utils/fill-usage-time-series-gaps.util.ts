// SeaRM — AGPL-3.0. Clean-room reimplementation of the usage ledger
// (no SeaRM Enterprise source consulted; behavior derived from
// consumer-facing test expectations for the admin usage charts).

export type UsageTimeSeriesPoint = {
  date: string;
  creditsUsed: number;
};

// Fills gaps in a sparse [date -> creditsUsed] series so every calendar day
// in [periodStart, periodEnd) is represented (periodEnd is treated as
// exclusive, matching the `timestamp < periodEnd` SQL semantics used to
// produce `rows`).
export const fillUsageTimeSeriesGaps = ({
  rows,
  periodStart,
  periodEnd,
}: {
  rows: UsageTimeSeriesPoint[];
  periodStart: Date;
  periodEnd: Date;
}): UsageTimeSeriesPoint[] => {
  const creditsByDate = new Map(rows.map((row) => [row.date, row.creditsUsed]));

  const toDateOnly = (date: Date) =>
    new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );

  const startDay = toDateOnly(periodStart);
  const lastIncludedDay = toDateOnly(
    new Date(periodEnd.getTime() - 1),
  );

  const result: UsageTimeSeriesPoint[] = [];

  for (
    let day = startDay;
    day.getTime() <= lastIncludedDay.getTime();
    day = new Date(day.getTime() + 24 * 60 * 60 * 1000)
  ) {
    const dateKey = day.toISOString().slice(0, 10);

    result.push({
      date: dateKey,
      creditsUsed: creditsByDate.get(dateKey) ?? 0,
    });
  }

  return result;
};
