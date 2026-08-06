import { buildToolFailure } from 'src/engine/core-modules/tool/utils/build-tool-failure.util';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';

export const wrapWithErrorHandler = (
  toolName: string,
  executeFn: (args: Record<string, unknown>) => Promise<ToolOutput>,
): ((args: Record<string, unknown>) => Promise<ToolOutput>) => {
  return async (args: Record<string, unknown>) => {
    try {
      return await executeFn(args);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return {
        success: false,
        message: `Failed to execute ${toolName}`,
        error: errorMessage,
        failure: buildToolFailure({
          code: 'INTERNAL_ERROR',
          message: `Failed to execute ${toolName}: ${errorMessage}`,
          hint: 'This looks like a transient failure. Retry once; if it persists, tell the user what you were trying to do.',
          retryable: true,
          allowedActions: ['retry'],
        }),
      };
    }
  };
};
