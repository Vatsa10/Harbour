import { type ObjectRecord } from 'searm-shared/types';

export type PartialObjectRecordWithId = Partial<ObjectRecord> & { id: string };
