import { Injectable } from '@nestjs/common';
import {
  OrderByWithGroupBy,
  type AggregateOrderByWithGroupByField,
  type ObjectRecordOrderByForCompositeField,
  type ObjectRecordOrderByForRelationField,
  type ObjectRecordOrderByForScalarField,
  type ObjectRecordOrderByWithGroupByDateField,
} from 'searm-shared/types';
import { isDefined } from 'searm-shared/utils';

@Injectable()
export class OrderByWithGroupByArgProcessorService {
  process({
    orderBy,
  }: {
    orderBy:
      | undefined
      | ObjectRecordOrderByForScalarField
      | ObjectRecordOrderByForCompositeField
      | ObjectRecordOrderByWithGroupByDateField
      | ObjectRecordOrderByForRelationField
      | AggregateOrderByWithGroupByField
      | OrderByWithGroupBy;
  }): OrderByWithGroupBy | undefined {
    if (Array.isArray(orderBy) || !isDefined(orderBy)) {
      return orderBy;
    }

    return [orderBy];
  }
}
