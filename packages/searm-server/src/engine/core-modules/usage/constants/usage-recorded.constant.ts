// SeaRM — AGPL-3.0. Clean-room reimplementation of the usage ledger
// (no SeaRM Enterprise source consulted; derived from consumer call sites).

import { type CustomEventName } from 'src/engine/workspace-event-emitter/types/custom-event-name.type';

// Event name emitted via WorkspaceEventEmitter#emitCustomBatchEvent whenever a
// unit of billable/trackable usage happens (AI tokens, workflow runs, logic
// function invocations, emails sent, ...). UsageEventListener subscribes to
// this via @OnEvent and persists the batch to ClickHouse.
export const USAGE_RECORDED: CustomEventName = 'usage_recorded';
