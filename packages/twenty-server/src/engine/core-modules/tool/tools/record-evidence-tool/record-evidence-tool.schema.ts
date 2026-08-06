import { z } from 'zod';

// The model reports WHAT it observed and WHERE. It never reports how much that
// observation is worth — strength is assigned server-side from the source type,
// so a confident-sounding model cannot promote its own guess.
export const RecordEvidenceInputZodSchema = z.object({
  objectNameSingular: z
    .string()
    .describe('The object the observed record belongs to, e.g. "company".'),
  recordId: z.string().uuid().describe('The id of the record observed.'),
  fieldName: z
    .string()
    .describe(
      'The field this observation is about, e.g. "employees". Use the exact field name from the schema.',
    ),
  value: z
    .unknown()
    .describe('The observed value for that field, as you would store it.'),
  sourceType: z
    .enum(['CRM_RECORD', 'CRM_ACTIVITY', 'WEB_SEARCH', 'MANUAL'])
    .describe(
      'Where the observation came from. CRM_RECORD and CRM_ACTIVITY are our own data; WEB_SEARCH is anything fetched from outside; MANUAL is a human statement.',
    ),
  sourceLocator: z
    .string()
    .min(1)
    .describe(
      'How a human would find this source again: a URL, a message id, or a record id. A reviewer clicks this to check your work.',
    ),
  snippet: z
    .string()
    .optional()
    .describe(
      'A short excerpt supporting the value, so a reviewer can judge it without opening the source.',
    ),
  observedAt: z
    .string()
    .datetime()
    .optional()
    .describe(
      'When the observation was made, ISO 8601. Defaults to now. Set it when the source carries its own date.',
    ),
});

export type RecordEvidenceToolInput = z.infer<
  typeof RecordEvidenceInputZodSchema
>;
