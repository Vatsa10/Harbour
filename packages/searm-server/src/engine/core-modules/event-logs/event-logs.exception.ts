// SeaRM: clean-room AGPL-3.0 rewrite. See
// .superpowers/sdd/enterprise-rewrite/event-logs-spec.md for design notes.
import { type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { assertUnreachable } from 'searm-shared/utils';

import { CustomException } from 'src/utils/custom-exception';

export enum EventLogsExceptionCode {
  CLICKHOUSE_NOT_CONFIGURED = 'CLICKHOUSE_NOT_CONFIGURED',
  INVALID_QUERY = 'INVALID_QUERY',
  QUERY_FAILED = 'QUERY_FAILED',
}

const getEventLogsExceptionUserFriendlyMessage = (
  code: EventLogsExceptionCode,
) => {
  switch (code) {
    case EventLogsExceptionCode.CLICKHOUSE_NOT_CONFIGURED:
      return msg`Event log storage is not configured for this instance.`;
    case EventLogsExceptionCode.INVALID_QUERY:
      return msg`This event log query is invalid.`;
    case EventLogsExceptionCode.QUERY_FAILED:
      return msg`Event logs could not be retrieved.`;
    default:
      assertUnreachable(code);
  }
};

export class EventLogsException extends CustomException<EventLogsExceptionCode> {
  constructor(
    message: string,
    code: EventLogsExceptionCode,
    { userFriendlyMessage }: { userFriendlyMessage?: MessageDescriptor } = {},
  ) {
    super(message, code, {
      userFriendlyMessage:
        userFriendlyMessage ?? getEventLogsExceptionUserFriendlyMessage(code),
    });
  }
}
