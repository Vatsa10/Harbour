import { computeImportIdentityKey } from 'src/modules/guided-import/utils/compute-import-identity-key.util';

describe('computeImportIdentityKey', () => {
  it('should key a person on the normalised primary email', () => {
    expect(
      computeImportIdentityKey('person', {
        emails: { primaryEmail: '  Jane@Acme.COM ' },
      }),
    ).toBe('person:jane@acme.com');
  });

  it('should key a company on the normalised domain, ignoring scheme and trailing slash', () => {
    expect(
      computeImportIdentityKey('company', {
        domainName: { primaryLinkUrl: 'https://ACME.com/' },
      }),
    ).toBe(
      computeImportIdentityKey('company', {
        domainName: { primaryLinkUrl: 'http://acme.com' },
      }),
    );
  });

  it('should fall back to the company name when no domain column was mapped', () => {
    expect(computeImportIdentityKey('company', { name: 'Acme Inc' })).toBe(
      'company:name:acme inc',
    );
  });

  it('should prefer the domain over the name when both are present', () => {
    expect(
      computeImportIdentityKey('company', {
        name: 'Acme Inc',
        domainName: { primaryLinkUrl: 'https://acme.com' },
      }),
    ).toBe('company:acme.com');
  });

  // Null means "no identity signal": such rows must never dedup against each
  // other, or an import of nameless rows would collapse into one record.
  it('should return null when there is no identity signal', () => {
    expect(computeImportIdentityKey('company', { employees: 10 })).toBeNull();
    expect(computeImportIdentityKey('company', { name: '   ' })).toBeNull();
    expect(
      computeImportIdentityKey('person', { emails: { primaryEmail: '' } }),
    ).toBeNull();
    expect(computeImportIdentityKey('opportunity', { name: 'Deal' })).toBeNull();
  });
});
