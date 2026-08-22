import { type RestrictedFieldsPermissions } from 'searm-shared/types';
import { z } from 'zod';

import { type ObjectMetadataForToolSchema } from 'src/engine/core-modules/record-crud/types/object-metadata-for-tool-schema.type';
import { generateRecordFilterSchema } from 'src/engine/core-modules/record-crud/zod-schemas/record-filter.zod-schema';

export const generateBulkDeleteToolInputSchema = (
  objectMetadata: ObjectMetadataForToolSchema,
  restrictedFields?: RestrictedFieldsPermissions,
) => {
  const { filterSchema } = generateRecordFilterSchema({
    objectMetadata,
    restrictedFields,
  });

  return z.object({
    filter: filterSchema.describe(
      'Filter to select which records to delete. Supports field-level filters and logical operators (or, and, not). WARNING: A broad filter may delete many records at once. Always verify the filter scope with a find query first.',
    ),
    // Declared because z.object() strips unrecognized keys before the tool
    // executes, so an undeclared confirm token would never reach the gate.
    confirm: z
      .string()
      .optional()
      .describe(
        'Confirmation token. Omit on the first call. If the workspace requires confirmation, the response tells you the exact token to pass here on a second, identical call.',
      ),
  });
};

export type BulkDeleteToolInput = {
  filter: Record<string, unknown>;
  confirm?: string;
};
