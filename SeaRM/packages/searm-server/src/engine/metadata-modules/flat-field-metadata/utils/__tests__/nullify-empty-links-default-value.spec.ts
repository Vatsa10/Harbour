import { nullifyEmptyLinksDefaultValue } from '../nullify-empty-links-default-value.util';

describe('nullifyEmptyLinksDefaultValue', () => {
  it('returns null when all sub-fields are empty-string equivalents', () => {
    expect(
      nullifyEmptyLinksDefaultValue({
        primaryLinkLabel: '',
        primaryLinkUrl: "''",
        secondaryLinks: null,
      }),
    ).toBeNull();
  });

  it('returns normalized object when primaryLinkUrl has a value', () => {
    expect(
      nullifyEmptyLinksDefaultValue({
        primaryLinkLabel: "''",
        primaryLinkUrl: 'https://searm.com',
        secondaryLinks: null,
      }),
    ).toEqual({
      primaryLinkLabel: null,
      primaryLinkUrl: 'https://searm.com',
      secondaryLinks: null,
    });
  });
});
