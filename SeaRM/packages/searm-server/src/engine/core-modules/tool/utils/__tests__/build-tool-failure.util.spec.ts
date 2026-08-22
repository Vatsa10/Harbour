import { type ToolFailureCode } from 'src/engine/core-modules/tool/types/tool-failure.type';
import {
  buildToolFailure,
  toFailedToolOutput,
} from 'src/engine/core-modules/tool/utils/build-tool-failure.util';

describe('buildToolFailure', () => {
  it('should default allowedActions to an empty array', () => {
    const failure = buildToolFailure({
      code: 'NOT_FOUND',
      message: 'No person with that id',
      hint: 'List people first with find_many_people to find the right id.',
      retryable: false,
    });

    expect(failure).toEqual({
      code: 'NOT_FOUND',
      message: 'No person with that id',
      hint: 'List people first with find_many_people to find the right id.',
      retryable: false,
      allowedActions: [],
    });
  });

  it('should keep the caller-supplied allowedActions', () => {
    const failure = buildToolFailure({
      code: 'UNKNOWN_TOOL',
      message: 'Tool "find_persons" not found',
      hint: 'Did you mean find_many_people?',
      retryable: false,
      allowedActions: ['find_many_people'],
    });

    expect(failure.allowedActions).toEqual(['find_many_people']);
  });

  it('should preserve retryable true rather than hardcoding a default', () => {
    const failure = buildToolFailure({
      code: 'RATE_LIMITED',
      message: 'Too many calls',
      hint: 'Wait a few seconds and issue the same call again.',
      retryable: true,
    });

    expect(failure.retryable).toBe(true);
  });
});

describe('toFailedToolOutput', () => {
  it('should shape a failed ToolOutput that carries both the legacy strings and the envelope', () => {
    const failure = buildToolFailure({
      code: 'PERMISSION_DENIED',
      message: 'You do not have access to this tool',
      hint: 'Call get_tool_catalog to see available tools.',
      retryable: false,
      allowedActions: ['get_tool_catalog'],
    });

    const output = toFailedToolOutput(failure);

    expect(output.success).toBe(false);
    expect(output.message).toBe(failure.message);
    // Surfaces that render only `error` today must still see the recovery
    // hint, so the legacy string carries message + hint.
    expect(output.error).toBe(
      'You do not have access to this tool Call get_tool_catalog to see available tools.',
    );
    expect(output.failure).toEqual(failure);
  });

  it('should never produce a success output', () => {
    const codes: ToolFailureCode[] = [
      'UNKNOWN_TOOL',
      'INVALID_ARGUMENTS',
      'NOT_FOUND',
      'FORBIDDEN_BY_POLICY',
      'PERMISSION_DENIED',
      'CONFIRMATION_REQUIRED',
      'DUPLICATE_PROPOSAL',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
    ];

    for (const code of codes) {
      const output = toFailedToolOutput(
        buildToolFailure({
          code,
          message: `failed: ${code}`,
          hint: 'do something else',
          retryable: false,
        }),
      );

      expect(output.success).toBe(false);
      expect(output.failure?.code).toBe(code);
    }
  });
});
