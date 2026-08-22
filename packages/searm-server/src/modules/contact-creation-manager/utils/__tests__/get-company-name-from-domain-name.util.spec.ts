import { type EachTestingContext } from 'searm-shared/testing';

import { getCompanyNameFromDomainName } from 'src/modules/contact-creation-manager/utils/get-company-name-from-domain-name.util';

type GetCompanyNameFromDomainNameTestCase = EachTestingContext<{
  input: string;
  expected: string;
}>;

describe('getCompanyNameFromDomainName', () => {
  const testCases: GetCompanyNameFromDomainNameTestCase[] = [
    {
      title: 'should extract and capitalize company name from simple domain',
      context: {
        input: 'searm.dev',
        expected: 'SeaRM',
      },
    },
    {
      title: 'should extract and capitalize company name from subdomain',
      context: {
        input: 'app.searm.dev',
        expected: 'SeaRM',
      },
    },
    {
      title:
        'should extract and capitalize company name from multiple subdomains',
      context: {
        input: 'test.app.searm.dev',
        expected: 'SeaRM',
      },
    },
    {
      title: 'should handle domain with multiple parts',
      context: {
        input: 'searm.co.uk',
        expected: 'SeaRM',
      },
    },
    {
      title: 'should handle empty string',
      context: {
        input: '',
        expected: '',
      },
    },
    {
      title: 'should handle invalid domain',
      context: {
        input: 'not-a-valid-domain',
        expected: '',
      },
    },
  ];

  test.each(testCases)('$title', ({ context: { input, expected } }) => {
    expect(getCompanyNameFromDomainName(input)).toBe(expected);
  });
});
