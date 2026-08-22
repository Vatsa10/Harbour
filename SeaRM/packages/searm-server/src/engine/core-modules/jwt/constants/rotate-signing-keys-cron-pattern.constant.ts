// SeaRM — AGPL-3.0. Clean-room reimplementation of the JWT signing key
// rotation cron cadence (no SeaRM Enterprise source consulted; derived from
// consumer call sites in cron-register-all.command.ts and the
// SIGNING_KEY_ROTATION_DAYS config description).
//
// Runs once daily at 00:00 UTC. Rotation itself is decided at day
// granularity via SIGNING_KEY_ROTATION_DAYS, so a daily check is the
// coarsest cadence that still enforces the configured threshold promptly.
// Midnight UTC is a fixed, deployment-independent anchor that keeps this
// job's logs aligned to calendar-day boundaries, consistent with other daily
// maintenance cron patterns in this codebase (e.g. trash cleanup, event log
// cleanup).
export const ROTATE_SIGNING_KEYS_CRON_PATTERN = '0 0 * * *';
