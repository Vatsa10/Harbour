import { ViewFilterOperand } from 'searm-shared/types';
import { relationFilterValueSchemaObject } from 'searm-shared/utils';
import z from 'zod';
import { urlRecursiveFilterGroupSchema } from './urlRecursiveFilterGroupSchema';

export const filterUrlQueryParamsSchema = z.object({
  filter: z
    .record(
      z.string(),
      z.partialRecord(
        z.enum(ViewFilterOperand),
        z.string().or(z.array(z.string())).or(relationFilterValueSchemaObject),
      ),
    )
    .optional(),
  filterGroup: urlRecursiveFilterGroupSchema.optional(),
});
