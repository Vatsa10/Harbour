import { msg } from '@lingui/core/macro';

import { type WorkspaceInternalContext } from 'src/engine/searm-orm/interfaces/workspace-internal-context.interface';

import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceEntityManager } from 'src/engine/searm-orm/entity-manager/workspace-entity-manager';
import {
  SearmORMException,
  SearmORMExceptionCode,
} from 'src/engine/searm-orm/exceptions/searm-orm.exception';

import { findConflictingRecord } from './find-conflicting-record.util';
import {
  parsePostgresConstraintError,
  type PostgreSQLError,
} from './parse-postgres-constraint-error.util';

interface DuplicateKeyErrorWithMetadata extends SearmORMException {
  conflictingRecordId?: string;
  conflictingObjectNameSingular?: string;
}

export const handleDuplicateKeyError = async (
  error: PostgreSQLError,
  objectMetadata: FlatObjectMetadata,
  internalContext: WorkspaceInternalContext,
  entityManager: WorkspaceEntityManager,
): Promise<DuplicateKeyErrorWithMetadata> => {
  const parsedError = parsePostgresConstraintError(error);

  if (!parsedError) {
    return new SearmORMException(
      `A duplicate entry was detected`,
      SearmORMExceptionCode.DUPLICATE_ENTRY_DETECTED,
      {
        userFriendlyMessage: msg`This record already exists. Please check your data and try again.`,
      },
    );
  }

  const conflictingRecord = await findConflictingRecord(
    parsedError.columnName,
    parsedError.conflictingValue,
    objectMetadata,
    internalContext,
    entityManager,
  );

  const fieldLabel = conflictingRecord?.fieldLabel;
  const userFriendlyMessage = fieldLabel
    ? msg`This ${fieldLabel} value is already in use. Please check your data and try again.`
    : msg`This record already exists. Please check your data and try again.`;

  const exception: DuplicateKeyErrorWithMetadata = new SearmORMException(
    `A duplicate entry was detected`,
    SearmORMExceptionCode.DUPLICATE_ENTRY_DETECTED,
    {
      userFriendlyMessage,
    },
  );

  if (conflictingRecord) {
    exception.conflictingRecordId = conflictingRecord.conflictingRecordId;
    exception.conflictingObjectNameSingular = objectMetadata.nameSingular;
  }

  return exception;
};
