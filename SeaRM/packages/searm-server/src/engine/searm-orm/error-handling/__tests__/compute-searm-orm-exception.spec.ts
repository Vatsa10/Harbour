import { msg } from '@lingui/core/macro';
import { QueryFailedError } from 'typeorm';

import { POSTGRESQL_ERROR_CODES } from 'src/engine/api/graphql/workspace-query-runner/constants/postgres-error-codes.constants';
import { handleDuplicateKeyError } from 'src/engine/api/graphql/workspace-query-runner/utils/handle-duplicate-key-error.util';
import { PostgresException } from 'src/engine/api/graphql/workspace-query-runner/utils/postgres-exception';
import { computeSearmORMException } from 'src/engine/searm-orm/error-handling/compute-searm-orm-exception';
import {
  SearmORMException,
  SearmORMExceptionCode,
} from 'src/engine/searm-orm/exceptions/searm-orm.exception';

jest.mock(
  'src/engine/api/graphql/workspace-query-runner/utils/handle-duplicate-key-error.util',
  () => ({
    handleDuplicateKeyError: jest.fn(),
  }),
);

const handleDuplicateKeyErrorMock = handleDuplicateKeyError as jest.Mock;

const buildQueryFailedError = (
  code: string | undefined,
  message = 'query failed',
): QueryFailedError => {
  const driverError = new Error(message);

  if (code !== undefined) {
    Object.assign(driverError, { code });
  }

  return new QueryFailedError('SELECT 1', [], driverError);
};

describe('computeSearmORMException', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return an INVALID_INPUT exception with a missing-field message when error is a NOT_NULL_VIOLATION', async () => {
    const error = buildQueryFailedError(
      POSTGRESQL_ERROR_CODES.NOT_NULL_VIOLATION,
    );

    const result = await computeSearmORMException(error);

    expect(result).toBeInstanceOf(SearmORMException);
    expect((result as SearmORMException).code).toBe(
      SearmORMExceptionCode.INVALID_INPUT,
    );
    expect((result as SearmORMException).userFriendlyMessage).toEqual(
      msg`A required field is missing. Please provide all required values and try again.`,
    );
  });

  it('should return an INVALID_INPUT exception with a relationship message when error is a FOREIGN_KEY_VIOLATION', async () => {
    const error = buildQueryFailedError(
      POSTGRESQL_ERROR_CODES.FOREIGN_KEY_VIOLATION,
    );

    const result = await computeSearmORMException(error);

    expect(result).toBeInstanceOf(SearmORMException);
    expect((result as SearmORMException).code).toBe(
      SearmORMExceptionCode.INVALID_INPUT,
    );
    expect((result as SearmORMException).userFriendlyMessage).toEqual(
      msg`This operation references a record that does not exist or cannot be modified due to existing relationships.`,
    );
  });

  it('should return an INVALID_INPUT exception with a still-referenced message when error is a RESTRICT_VIOLATION', async () => {
    const error = buildQueryFailedError(
      POSTGRESQL_ERROR_CODES.RESTRICT_VIOLATION,
    );

    const result = await computeSearmORMException(error);

    expect(result).toBeInstanceOf(SearmORMException);
    expect((result as SearmORMException).code).toBe(
      SearmORMExceptionCode.INVALID_INPUT,
    );
    expect((result as SearmORMException).userFriendlyMessage).toEqual(
      msg`This record cannot be deleted because it is still referenced by other records.`,
    );
  });

  it('should preserve the original message when surfacing a constraint violation as INVALID_INPUT', async () => {
    const error = buildQueryFailedError(
      POSTGRESQL_ERROR_CODES.NOT_NULL_VIOLATION,
      'null value in column "name" violates not-null constraint',
    );

    const result = await computeSearmORMException(error);

    expect((result as SearmORMException).message).toBe(
      'null value in column "name" violates not-null constraint',
    );
  });

  it('should throw the generic PostgresException when error is a CHECK_VIOLATION (handled by the catch-all)', async () => {
    const error = buildQueryFailedError(POSTGRESQL_ERROR_CODES.CHECK_VIOLATION);

    await expect(computeSearmORMException(error)).rejects.toThrow(
      PostgresException,
    );
    await expect(computeSearmORMException(error)).rejects.toMatchObject({
      message: 'Data validation error.',
      code: POSTGRESQL_ERROR_CODES.CHECK_VIOLATION,
    });
  });

  it('should return an INVALID_INPUT exception with the original message when error is an INVALID_TEXT_REPRESENTATION', async () => {
    const error = buildQueryFailedError(
      POSTGRESQL_ERROR_CODES.INVALID_TEXT_REPRESENTATION,
      'invalid input syntax for type uuid',
    );

    const result = await computeSearmORMException(error);

    expect(result).toBeInstanceOf(SearmORMException);
    expect((result as SearmORMException).code).toBe(
      SearmORMExceptionCode.INVALID_INPUT,
    );
    expect((result as SearmORMException).message).toBe(
      'invalid input syntax for type uuid',
    );
  });

  it('should return a QUERY_READ_TIMEOUT exception when error message mentions a query read timeout', async () => {
    const error = buildQueryFailedError(undefined, 'Query read timeout');

    const result = await computeSearmORMException(error);

    expect(result).toBeInstanceOf(SearmORMException);
    expect((result as SearmORMException).code).toBe(
      SearmORMExceptionCode.QUERY_READ_TIMEOUT,
    );
  });

  it('should delegate to handleDuplicateKeyError when error is a UNIQUE_VIOLATION and metadata context is provided', async () => {
    const error = buildQueryFailedError(
      POSTGRESQL_ERROR_CODES.UNIQUE_VIOLATION,
    );
    const objectMetadata = { nameSingular: 'person' } as never;
    const entityManager = {} as never;
    const internalContext = {} as never;
    const duplicateException = new SearmORMException(
      'A duplicate entry was detected',
      SearmORMExceptionCode.DUPLICATE_ENTRY_DETECTED,
    );

    handleDuplicateKeyErrorMock.mockResolvedValue(duplicateException);

    const result = await computeSearmORMException(
      error,
      objectMetadata,
      entityManager,
      internalContext,
    );

    expect(handleDuplicateKeyErrorMock).toHaveBeenCalledWith(
      error,
      objectMetadata,
      internalContext,
      entityManager,
    );
    expect(result).toBe(duplicateException);
  });

  it('should throw the generic PostgresException when error is a known postgres code without dedicated handling', async () => {
    const error = buildQueryFailedError(
      POSTGRESQL_ERROR_CODES.SERIALIZATION_FAILURE,
    );

    await expect(computeSearmORMException(error)).rejects.toThrow(
      PostgresException,
    );
    await expect(computeSearmORMException(error)).rejects.toMatchObject({
      message: 'Data validation error.',
      code: POSTGRESQL_ERROR_CODES.SERIALIZATION_FAILURE,
    });
  });

  it('should rethrow the original error when error is a QueryFailedError with an unknown code', async () => {
    const error = buildQueryFailedError('99999');

    await expect(computeSearmORMException(error)).rejects.toBe(error);
  });

  it('should return the error unchanged when error is not a QueryFailedError', async () => {
    const error = new Error('some unrelated error');

    const result = await computeSearmORMException(error);

    expect(result).toBe(error);
  });
});
