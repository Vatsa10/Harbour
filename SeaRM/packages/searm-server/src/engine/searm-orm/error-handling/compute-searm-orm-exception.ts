import { type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { isDefined } from 'searm-shared/utils';
import { QueryFailedError } from 'typeorm';

import { type WorkspaceInternalContext } from 'src/engine/searm-orm/interfaces/workspace-internal-context.interface';

import { POSTGRESQL_ERROR_CODES } from 'src/engine/api/graphql/workspace-query-runner/constants/postgres-error-codes.constants';
import { handleDuplicateKeyError } from 'src/engine/api/graphql/workspace-query-runner/utils/handle-duplicate-key-error.util';
import { PostgresException } from 'src/engine/api/graphql/workspace-query-runner/utils/postgres-exception';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceEntityManager } from 'src/engine/searm-orm/entity-manager/workspace-entity-manager';
import {
  SearmORMException,
  SearmORMExceptionCode,
} from 'src/engine/searm-orm/exceptions/searm-orm.exception';

interface QueryFailedErrorWithCode extends QueryFailedError {
  code?: string;
}

const CONSTRAINT_VIOLATION_MESSAGES: Record<string, MessageDescriptor> = {
  [POSTGRESQL_ERROR_CODES.NOT_NULL_VIOLATION]: msg`A required field is missing. Please provide all required values and try again.`,
  [POSTGRESQL_ERROR_CODES.FOREIGN_KEY_VIOLATION]: msg`This operation references a record that does not exist or cannot be modified due to existing relationships.`,
  [POSTGRESQL_ERROR_CODES.RESTRICT_VIOLATION]: msg`This record cannot be deleted because it is still referenced by other records.`,
};

export const computeSearmORMException = async (
  error: Error,
  objectMetadata?: FlatObjectMetadata,
  entityManager?: WorkspaceEntityManager,
  internalContext?: WorkspaceInternalContext,
): Promise<Error | SearmORMException> => {
  if (error instanceof QueryFailedError) {
    if (error.message.includes('Query read timeout')) {
      return new SearmORMException(
        'Query read timeout',
        SearmORMExceptionCode.QUERY_READ_TIMEOUT,
        {
          userFriendlyMessage: msg`We are experiencing a temporary issue with our database. Please try again later.`,
        },
      );
    }

    const errorCode = (error as QueryFailedErrorWithCode).code;

    if (
      errorCode === POSTGRESQL_ERROR_CODES.UNIQUE_VIOLATION &&
      isDefined(objectMetadata) &&
      isDefined(entityManager) &&
      isDefined(internalContext)
    ) {
      return await handleDuplicateKeyError(
        error,
        objectMetadata,
        internalContext,
        entityManager,
      );
    }

    if (errorCode === POSTGRESQL_ERROR_CODES.INVALID_TEXT_REPRESENTATION) {
      return new SearmORMException(
        error.message,
        SearmORMExceptionCode.INVALID_INPUT,
      );
    }

    if (isDefined(errorCode) && errorCode in CONSTRAINT_VIOLATION_MESSAGES) {
      return new SearmORMException(
        error.message,
        SearmORMExceptionCode.INVALID_INPUT,
        {
          userFriendlyMessage: CONSTRAINT_VIOLATION_MESSAGES[errorCode],
        },
      );
    }

    if (
      isDefined(errorCode) &&
      Object.values(POSTGRESQL_ERROR_CODES).includes(errorCode)
    ) {
      throw new PostgresException('Data validation error.', errorCode);
    }
    throw error;
  }

  return error;
};
