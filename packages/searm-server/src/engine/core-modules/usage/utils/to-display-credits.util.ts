// SeaRM — AGPL-3.0. Clean-room reimplementation of the usage ledger
// (no SeaRM Enterprise source consulted; derived from consumer call sites).

// `creditsUsedMicro` values (see UsageEvent / UsageEventRow, and
// convertDollarsToBillingCredits which produces them: dollars * 1_000_000)
// already denominate whole "credits" — displaying them raw would just show
// large integers. This rounds to 2 decimal places for a stable, readable
// number in the UI (agent chat thread totals, admin usage charts).
export const toDisplayCredits = (internalCredits: number): number =>
  Math.round(internalCredits * 100) / 100;
