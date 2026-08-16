import { type ActorMetadata } from 'twenty-shared/types';

import { type RecordCrudExecutionContext } from './record-crud-execution-context.type';

export type UpdateRecordExecutionContext = RecordCrudExecutionContext & {
  updatedBy?: ActorMetadata;
  // Set only by the proposal-approval path. The automation blocklist exists to
  // stop *unattended* automations rewriting ingestion-owned rows; an approved
  // proposal is the opposite case — a named human pressed approve and the
  // write runs as them, under their role. Never set this from an
  // agent-reachable path: it would turn the blocklist off for automation.
  isHumanApproved?: boolean;
};
