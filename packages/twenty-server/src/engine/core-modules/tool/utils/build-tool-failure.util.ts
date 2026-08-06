import {
  type ToolFailure,
  type ToolFailureCode,
} from 'src/engine/core-modules/tool/types/tool-failure.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';

export const buildToolFailure = (params: {
  code: ToolFailureCode;
  message: string;
  hint: string;
  retryable: boolean;
  allowedActions?: string[];
}): ToolFailure => ({
  code: params.code,
  message: params.message,
  hint: params.hint,
  retryable: params.retryable,
  allowedActions: params.allowedActions ?? [],
});

// The legacy `error`/`message` strings stay populated from the same failure
// so nothing reading the old shape breaks during the migration. `error` also
// carries the hint, because today's agent-facing surfaces render `error` only.
export const toFailedToolOutput = (failure: ToolFailure): ToolOutput => ({
  success: false,
  message: failure.message,
  error: `${failure.message} ${failure.hint}`,
  failure,
});
