import { isDefined } from 'searm-shared/utils';

import { UserInputError } from 'src/engine/core-modules/graphql/utils/graphql-errors.util';
import {
  type SearmORMException,
  SearmORMExceptionCode,
} from 'src/engine/searm-orm/exceptions/searm-orm.exception';

interface DuplicateKeyErrorWithMetadata extends SearmORMException {
  conflictingRecordId?: string;
  conflictingObjectNameSingular?: string;
}

export const searmORMGraphqlApiExceptionHandler = (
  error: SearmORMException,
) => {
  switch (error.code) {
    case SearmORMExceptionCode.DUPLICATE_ENTRY_DETECTED: {
      const duplicateKeyError: DuplicateKeyErrorWithMetadata = error;

      const extensions: Record<string, unknown> = {
        userFriendlyMessage: error.userFriendlyMessage,
        ...(isDefined(duplicateKeyError.conflictingRecordId) &&
        isDefined(duplicateKeyError.conflictingObjectNameSingular)
          ? {
              conflictingRecordId: duplicateKeyError.conflictingRecordId,
              conflictingObjectNameSingular:
                duplicateKeyError.conflictingObjectNameSingular,
            }
          : {}),
      };

      throw new UserInputError(error.message, extensions);
    }

    case SearmORMExceptionCode.INVALID_INPUT:
    case SearmORMExceptionCode.CONNECT_RECORD_NOT_FOUND:
    case SearmORMExceptionCode.CONNECT_NOT_ALLOWED:
    case SearmORMExceptionCode.CONNECT_UNIQUE_CONSTRAINT_ERROR:
    case SearmORMExceptionCode.RLS_VALIDATION_FAILED:
    case SearmORMExceptionCode.TOO_MANY_RECORDS_TO_UPDATE:
      throw new UserInputError(error.message, {
        userFriendlyMessage: error.userFriendlyMessage,
      });
    default: {
      throw error;
    }
  }
};
