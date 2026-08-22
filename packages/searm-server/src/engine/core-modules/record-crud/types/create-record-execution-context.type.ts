import { type ActorMetadata } from 'searm-shared/types';

import { type RecordCrudExecutionContext } from './record-crud-execution-context.type';

export type CreateRecordExecutionContext = RecordCrudExecutionContext & {
  createdBy?: ActorMetadata;
};
