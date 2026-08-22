import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('ImportBatchPreview')
export class ImportBatchPreviewDTO {
  @Field(() => Int)
  totalRows: number;

  @Field(() => Int)
  createCount: number;

  @Field(() => Int)
  updateCount: number;

  @Field(() => Int)
  proposeCount: number;

  @Field(() => Int)
  skipCount: number;

  @Field(() => Int)
  rowsWithErrorsCount: number;
}
