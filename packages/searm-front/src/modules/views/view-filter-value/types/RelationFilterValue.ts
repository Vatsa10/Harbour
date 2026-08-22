import { type jsonRelationFilterValueSchema } from 'searm-shared/utils';
import { type z } from 'zod';

export type RelationFilterValue = z.infer<typeof jsonRelationFilterValueSchema>;
