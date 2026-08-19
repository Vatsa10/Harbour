// SeaRM — AGPL-3.0. Clean-room reimplementation of the usage ledger
// (no Twenty Enterprise source consulted; derived from consumer call sites).

import { DOLLAR_TO_CREDIT_MULTIPLIER } from 'src/engine/metadata-modules/ai/ai-billing/constants/dollar-to-credit-multiplier';

// Exact inverse of convertDollarsToBillingCredits (dollars * DOLLAR_TO_CREDIT_MULTIPLIER),
// used by the admin usage-by-workspace view when billing is disabled and we
// want to show the real underlying cost instead of the credits abstraction.
export const toDollars = (internalCredits: number): number =>
  internalCredits / DOLLAR_TO_CREDIT_MULTIPLIER;
