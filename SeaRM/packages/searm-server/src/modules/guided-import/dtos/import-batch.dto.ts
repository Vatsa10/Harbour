import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

import { ImportBatchStatus } from 'src/modules/guided-import/types/import-batch-status.type';

registerEnumType(ImportBatchStatus, { name: 'ImportBatchStatus' });

@ObjectType('ImportBatch')
export class ImportBatchDTO {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  objectNameSingular: string;

  @Field(() => String)
  fileName: string;

  @Field(() => ImportBatchStatus)
  status: ImportBatchStatus;

  @Field(() => Int)
  totalRows: number;

  @Field(() => Int)
  processedRows: number;

  @Field(() => Int)
  createdRowCount: number;

  @Field(() => Int)
  updatedRowCount: number;

  @Field(() => Int)
  proposedRowCount: number;

  @Field(() => Int)
  skippedRowCount: number;

  @Field(() => Int)
  failedRowCount: number;
}
