import { isDefined } from 'twenty-shared/utils';

// The identity of a row for intra-import dedup: the same normalised value the
// match-resolution pass used to look the row up in the database, lowercased
// and trimmed. Null means "this row has no identity signal" — such rows are
// never deduped against each other.
//
// Match resolution runs once, up front, against records that existed *before*
// the import. Rows the import itself creates are invisible to it, so two rows
// naming the same new company both resolve to CREATE. This key is how the
// execute pass notices the second one.
export const computeImportIdentityKey = (
  objectNameSingular: string,
  mappedData: Record<string, unknown>,
): string | null => {
  const normalise = (value: string | undefined | null): string | null => {
    const trimmed = value?.trim().toLowerCase();

    return isDefined(trimmed) && trimmed.length > 0 ? trimmed : null;
  };

  if (objectNameSingular === 'person') {
    const emails = mappedData.emails as { primaryEmail?: string } | undefined;
    const email = normalise(emails?.primaryEmail);

    return isDefined(email) ? `person:${email}` : null;
  }

  if (objectNameSingular === 'company') {
    const domainName = mappedData.domainName as
      | { primaryLinkUrl?: string }
      | undefined;
    const domain = normalise(
      domainName?.primaryLinkUrl?.replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    );

    if (isDefined(domain)) {
      return `company:${domain}`;
    }

    // A company CSV without a domain column is common; the name is then the
    // only identity the import has.
    const name = normalise(mappedData.name as string | undefined);

    return isDefined(name) ? `company:name:${name}` : null;
  }

  return null;
};
