import { isValidSearmSubdomain } from '@/utils/validation/isValidSearmSubdomain';

describe('isValidSearmSubdomain', () => {
  describe('valid subdomains', () => {
    it('should accept standard alphanumeric subdomains', () => {
      expect(isValidSearmSubdomain('abc')).toBe(true);
      expect(isValidSearmSubdomain('test123')).toBe(true);
      expect(isValidSearmSubdomain('company1')).toBe(true);
      expect(isValidSearmSubdomain('workspace2024')).toBe(true);
    });

    it('should accept subdomains with hyphens in the middle', () => {
      expect(isValidSearmSubdomain('my-company')).toBe(true);
      expect(isValidSearmSubdomain('test-workspace')).toBe(true);
      expect(isValidSearmSubdomain('multi-word-subdomain')).toBe(true);
      expect(isValidSearmSubdomain('a-b-c-d-e')).toBe(true);
    });

    it('should accept minimum length subdomains (3 characters)', () => {
      expect(isValidSearmSubdomain('abc')).toBe(true);
      expect(isValidSearmSubdomain('a1b')).toBe(true);
      expect(isValidSearmSubdomain('a-b')).toBe(true);
    });

    it('should accept maximum length subdomains (30 characters)', () => {
      const exactly30 = 'a' + 'b'.repeat(28) + 'c';

      expect(exactly30.length).toBe(30);
      expect(isValidSearmSubdomain(exactly30)).toBe(true);
    });

    it('should accept numeric-only subdomains', () => {
      expect(isValidSearmSubdomain('123')).toBe(true);
      expect(isValidSearmSubdomain('456789')).toBe(true);
      expect(isValidSearmSubdomain('1-2-3')).toBe(true);
    });
  });

  describe('invalid subdomains', () => {
    it('should reject empty strings', () => {
      expect(isValidSearmSubdomain('')).toBe(false);
    });

    it('should reject subdomains shorter than 3 characters', () => {
      expect(isValidSearmSubdomain('a')).toBe(false);
      expect(isValidSearmSubdomain('ab')).toBe(false);
    });

    it('should reject subdomains longer than 30 characters', () => {
      const tooLong = 'a'.repeat(31);

      expect(isValidSearmSubdomain(tooLong)).toBe(false);
    });

    it('should reject subdomains starting with a hyphen', () => {
      expect(isValidSearmSubdomain('-test')).toBe(false);
      expect(isValidSearmSubdomain('-abc')).toBe(false);
    });

    it('should reject subdomains ending with a hyphen', () => {
      expect(isValidSearmSubdomain('test-')).toBe(false);
      expect(isValidSearmSubdomain('abc-')).toBe(false);
    });

    it('should reject subdomains with uppercase letters', () => {
      expect(isValidSearmSubdomain('Test')).toBe(false);
      expect(isValidSearmSubdomain('MyCompany')).toBe(false);
      expect(isValidSearmSubdomain('WORKSPACE')).toBe(false);
    });

    it('should reject subdomains with special characters', () => {
      expect(isValidSearmSubdomain('test@company')).toBe(false);
      expect(isValidSearmSubdomain('my_workspace')).toBe(false);
      expect(isValidSearmSubdomain('test.company')).toBe(false);
      expect(isValidSearmSubdomain('workspace#1')).toBe(false);
    });

    it('should reject subdomains with spaces', () => {
      expect(isValidSearmSubdomain('test company')).toBe(false);
      expect(isValidSearmSubdomain(' test')).toBe(false);
      expect(isValidSearmSubdomain('test ')).toBe(false);
    });

    it('should reject subdomains starting with "api-"', () => {
      expect(isValidSearmSubdomain('api-test')).toBe(false);
      expect(isValidSearmSubdomain('api-company')).toBe(false);
      expect(isValidSearmSubdomain('api-123')).toBe(false);
    });

    it('should accept subdomains containing "api" not as prefix', () => {
      expect(isValidSearmSubdomain('myapi')).toBe(true);
      expect(isValidSearmSubdomain('rapid')).toBe(true);
    });

    it('should reject subdomains with only hyphens', () => {
      expect(isValidSearmSubdomain('---')).toBe(false);
      expect(isValidSearmSubdomain('----')).toBe(false);
    });

    it('should reject whitespace-only strings', () => {
      expect(isValidSearmSubdomain('   ')).toBe(false);
      expect(isValidSearmSubdomain('\t')).toBe(false);
      expect(isValidSearmSubdomain('\n')).toBe(false);
    });

    it('should reject unicode characters', () => {
      expect(isValidSearmSubdomain('café')).toBe(false);
      expect(isValidSearmSubdomain('tëst')).toBe(false);
    });
  });
});
