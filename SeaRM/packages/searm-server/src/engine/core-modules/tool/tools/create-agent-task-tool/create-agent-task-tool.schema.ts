import { z } from 'zod';

export const CreateAgentTaskInputZodSchema = z.object({
  objectNameSingular: z
    .string()
    .describe('The object the record to research belongs to, e.g. "company".'),
  recordId: z.string().uuid().describe('The id of the record to research.'),
  reason: z
    .string()
    .describe(
      'Why this research is worth doing now, in one sentence. A human reads this in the task list.',
    ),
  priority: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Higher runs first. Leave unset unless this is urgent.'),
  budget: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      'Maximum number of agent steps the research run may take. Defaults to 8.',
    ),
});

export type CreateAgentTaskToolInput = z.infer<
  typeof CreateAgentTaskInputZodSchema
>;
