// Postgres `unique_violation`. Used where a read-then-write dedupe is backed
// by a unique index: the index, not the read, is the authority, and losing the
// race is an ordinary outcome rather than a fault.
const PG_UNIQUE_VIOLATION = '23505';

export const isPostgresUniqueViolation = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  // TypeORM's QueryFailedError copies the driver error's own properties onto
  // itself on most driver versions but not all, so both places are checked.
  const { code, driverError } = error as {
    code?: unknown;
    driverError?: { code?: unknown };
  };

  return (
    code === PG_UNIQUE_VIOLATION || driverError?.code === PG_UNIQUE_VIOLATION
  );
};
