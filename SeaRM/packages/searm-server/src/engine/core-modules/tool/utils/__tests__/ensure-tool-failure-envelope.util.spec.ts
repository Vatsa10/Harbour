import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { ensureToolFailureEnvelope } from 'src/engine/core-modules/tool/utils/ensure-tool-failure-envelope.util';

// Phase-4 review I1: the envelope stopped at the executor boundary, so the
// most frequent agent-facing failures -- the bare English strings the
// record-crud services and static tool providers return -- reached the model
// with no code, hint or retryable flag. These pin the classification.
describe('ensureToolFailureEnvelope', () => {
  it('leaves a successful output untouched', () => {
    const output: ToolOutput = { success: true, message: 'ok' };

    expect(ensureToolFailureEnvelope(output)).toBe(output);
  });

  it('does not overwrite a failure the caller already authored', () => {
    const output = {
      success: false,
      message: 'nope',
      failure: {
        code: 'FORBIDDEN_BY_POLICY',
        message: 'nope',
        hint: 'ask a human',
        retryable: false,
        allowedActions: [],
      },
    } as unknown as ToolOutput;

    expect(ensureToolFailureEnvelope(output)).toBe(output);
  });

  it('classifies a "record not found" string as a non-retryable NOT_FOUND', () => {
    const result = ensureToolFailureEnvelope({
      success: false,
      error: 'Record not found',
    } as unknown as ToolOutput);

    expect(result.failure?.code).toBe('NOT_FOUND');
    expect(result.failure?.retryable).toBe(false);
    expect(result.failure?.hint).toEqual(expect.any(String));
  });

  it('classifies a permission refusal as PERMISSION_DENIED', () => {
    const result = ensureToolFailureEnvelope({
      success: false,
      error: 'You do not have permission to update this field',
    } as unknown as ToolOutput);

    expect(result.failure?.code).toBe('PERMISSION_DENIED');
    expect(result.failure?.retryable).toBe(false);
  });

  it('classifies a bad field name as a retryable INVALID_ARGUMENTS', () => {
    const result = ensureToolFailureEnvelope({
      success: false,
      error: 'Unknown field "emial" on object person',
    } as unknown as ToolOutput);

    expect(result.failure?.code).toBe('INVALID_ARGUMENTS');
    expect(result.failure?.retryable).toBe(true);
  });

  // An unrecognised message must never be guessed into something retryable:
  // that is how an agent ends up in a retry loop against a permanent failure.
  it('falls back to a non-retryable INTERNAL_ERROR for an unrecognised message', () => {
    const result = ensureToolFailureEnvelope({
      success: false,
      error: 'kaboom',
    } as unknown as ToolOutput);

    expect(result.failure?.code).toBe('INTERNAL_ERROR');
    expect(result.failure?.retryable).toBe(false);
  });

  it('preserves the legacy error and message strings verbatim', () => {
    const result = ensureToolFailureEnvelope({
      success: false,
      message: 'Record not found',
      error: 'Record not found',
    } as unknown as ToolOutput);

    expect(result.error).toBe('Record not found');
    expect(result.message).toBe('Record not found');
  });
});
