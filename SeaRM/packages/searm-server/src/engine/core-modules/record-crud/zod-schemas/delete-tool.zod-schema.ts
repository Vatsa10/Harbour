import { z } from 'zod';

export const DeleteToolInputSchema = z.object({
  id: z.string().uuid().describe('The unique UUID of the record to delete'),
  // Declared because z.object() strips unrecognized keys before the tool
  // executes, so an undeclared confirm token would never reach the gate.
  confirm: z
    .string()
    .optional()
    .describe(
      'Confirmation token. Omit on the first call. If the workspace requires confirmation, the response tells you the exact token to pass here on a second, identical call.',
    ),
});

export type DeleteToolInput = z.infer<typeof DeleteToolInputSchema>;
