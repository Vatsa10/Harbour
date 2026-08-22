import { extractDomainFromLink } from 'src/modules/contact-creation-manager/utils/extract-domain-from-link.util';

describe('extractDomainFromLink', () => {
  it('should extract domain from link', () => {
    const link = 'https://www.searm.com';
    const result = extractDomainFromLink(link);

    expect(result).toBe('searm.com');
  });

  it('should extract domain from link without www', () => {
    const link = 'https://searm.com';
    const result = extractDomainFromLink(link);

    expect(result).toBe('searm.com');
  });

  it('should extract domain from link without protocol', () => {
    const link = 'searm.com';
    const result = extractDomainFromLink(link);

    expect(result).toBe('searm.com');
  });

  it('should extract domain from link with path', () => {
    const link = 'https://searm.com/about';
    const result = extractDomainFromLink(link);

    expect(result).toBe('searm.com');
  });
});
