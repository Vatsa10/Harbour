import { registerEnumType } from '@nestjs/graphql';

import { EventLogTable } from 'searm-shared/types';

export const registerEventLogTableEnum = () => {
  registerEnumType(EventLogTable, {
    name: 'EventLogTable',
  });
};
