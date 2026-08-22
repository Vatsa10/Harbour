import { isNonEmptyString } from '@sniptt/guards';
import { formatEmailAddress } from 'searm-shared/utils';

import { mimeEncode } from 'src/modules/messaging/message-import-manager/utils/mime-encode.util';

export const formatMessageFromHeader = ({
  fromEmail,
  fromName,
}: {
  fromEmail: string;
  fromName?: string | null;
}) => {
  return formatEmailAddress({
    address: fromEmail,
    name: isNonEmptyString(fromName) ? mimeEncode(fromName) : undefined,
  });
};
