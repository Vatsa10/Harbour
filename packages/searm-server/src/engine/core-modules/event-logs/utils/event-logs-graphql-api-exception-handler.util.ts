// SeaRM: clean-room AGPL-3.0 rewrite. See
// .superpowers/sdd/enterprise-rewrite/event-logs-spec.md for design notes.
import { assertUnreachable } from 'searm-shared/utils';

import {
  EventLogsException,
  EventLogsExceptionCode,
} from 'src/engine/core-modules/event-logs/event-logs.exception';
import { UserInputError } from 'src/engine/core-modules/graphql/utils/graphql-errors.util';

export const eventLogsGraphqlApiExceptionHandler = (error: Error) => {
  if (error instanceof EventLogsException) {
    switch (error.code) {
      case EventLogsExceptionCode.CLICKHOUSE_NOT_CONFIGURED:
        throw new UserInputError(error.message, {
          userFriendlyMessage: error.userFriendlyMessage,
        });
      case EventLogsExceptionCode.INVALID_QUERY:
        throw new UserInputError(error.message, {
          userFriendlyMessage: error.userFriendlyMessage,
        });
      case EventLogsExceptionCode.QUERY_FAILED:
        throw new UserInputError(error.message, {
          userFriendlyMessage: error.userFriendlyMessage,
        });
      default: {
        return assertUnreachable(error.code);
      }
    }
  }

  throw error;
};
