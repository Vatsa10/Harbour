import { type RecordReference } from 'src/engine/core-modules/tool/types/record-reference.type';
import { type ToolFailure } from 'src/engine/core-modules/tool/types/tool-failure.type';

export type ToolOutput<T = object> = {
  success: boolean;
  message: string;
  error?: string;
  result?: T;
  warnings?: string[];
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  recordReferences?: RecordReference[];
  // Structured failure detail. Optional and additive: every call site that
  // only sets `error`/`message` today keeps working unchanged. New and
  // migrated call sites also set this so an agent can recover without
  // parsing English.
  failure?: ToolFailure;
};
