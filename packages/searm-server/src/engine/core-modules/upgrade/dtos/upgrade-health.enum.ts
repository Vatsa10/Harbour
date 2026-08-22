import { registerEnumType } from '@nestjs/graphql';

import { UpgradeHealthEnum } from 'searm-shared/types';

export { UpgradeHealthEnum };

registerEnumType(UpgradeHealthEnum, {
  name: 'UpgradeHealth',
});
