import { Field, InputType } from '@nestjs/graphql';

import { GraphQLJSON } from 'graphql-type-json';

@InputType()
export class CreateImportBatchInput {
  @Field(() => String)
  objectNameSingular: string;

  @Field(() => String)
  fileName: string;

  // One element per row, keyed by original CSV header — kept verbatim so a
  // failed row can be re-exported in the format the user re-uploads (Task 10).
  @Field(() => [GraphQLJSON])
  rawRows: Record<string, unknown>[];

  // Same rows, index-aligned with rawRows, already translated into Twenty
  // object-field shape by the existing frontend mapping wizard
  // (buildRecordFromImportedStructuredRow — on disk today, already handles
  // composite fields: emails, address, fullName, links, currency, phones).
  // The backend does not re-derive this: duplicating composite-field
  // translation server-side would be a second, divergent implementation of
  // logic that already works. See Task 7.
  @Field(() => [GraphQLJSON])
  mappedRows: Record<string, unknown>[];

  // header -> object field name, for display only (the "how did this file
  // map" summary shown in the review step).
  @Field(() => GraphQLJSON)
  columnMapping: Record<string, string>;
}
