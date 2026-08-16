import { isDefined } from 'twenty-shared/utils';

import { buildToolFailure } from 'src/engine/core-modules/tool/utils/build-tool-failure.util';
import { type ToolFailureCode } from 'src/engine/core-modules/tool/types/tool-failure.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';

// The record-crud services and the static tool providers predate the envelope
// and report failure as `{ success: false, error: '<english>' }`. Those are the
// most frequent agent-facing failures there are — bad field name, record not
// found, write refused by field permissions — so the executor classifies them
// on the way out rather than leaving the agent to parse prose.
const CLASSIFIERS: {
  code: ToolFailureCode;
  pattern: RegExp;
  hint: string;
  retryable: boolean;
  allowedActions: string[];
}[] = [
  {
    code: 'NOT_FOUND',
    pattern: /not\s*found|does not exist|no record/i,
    hint: 'Confirm the record still exists with a find_many call before retrying with a different id or filter.',
    retryable: false,
    allowedActions: ['find_records'],
  },
  {
    code: 'PERMISSION_DENIED',
    pattern: /permission|not allowed|forbidden|unauthorized|restricted/i,
    hint: 'You may not write this object or field. Ask a human to make this change, or choose a field you can write.',
    retryable: false,
    allowedActions: ['get_tool_catalog'],
  },
  {
    code: 'INVALID_ARGUMENTS',
    pattern:
      /invalid|unknown field|malformed|must be|expected|required|cannot be null|constraint/i,
    hint: 'Re-read the tool schema and reissue the call with corrected arguments.',
    retryable: true,
    allowedActions: ['get_tool_catalog', 'retry'],
  },
];

export const ensureToolFailureEnvelope = (output: ToolOutput): ToolOutput => {
  if (output.success !== false || isDefined(output.failure)) {
    return output;
  }

  const text = `${output.error ?? ''} ${output.message ?? ''}`;
  const classifier = CLASSIFIERS.find((candidate) =>
    candidate.pattern.test(text),
  );

  const failure = buildToolFailure({
    code: classifier?.code ?? 'INTERNAL_ERROR',
    message: output.message ?? output.error ?? 'The tool call failed.',
    hint:
      classifier?.hint ??
      'The tool failed for a reason it could not classify. Report the error to a human rather than retrying in a loop.',
    retryable: classifier?.retryable ?? false,
    allowedActions: classifier?.allowedActions ?? [],
  });

  // The legacy strings are left exactly as the tool wrote them: consumers
  // rendering `error` today must not see their text change.
  return { ...output, failure };
};
