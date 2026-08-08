import { normalizePersonDisplayName } from 'src/modules/match-participant/utils/normalize-person-display-name.util';

describe('normalizePersonDisplayName', () => {
  it('should lowercase and trim', () => {
    expect(normalizePersonDisplayName('  Ada Lovelace  ')).toBe('ada lovelace');
  });

  it('should collapse repeated whitespace', () => {
    expect(normalizePersonDisplayName('Ada   Lovelace')).toBe('ada lovelace');
  });

  it('should return an empty string for null or undefined', () => {
    expect(normalizePersonDisplayName(null)).toBe('');
    expect(normalizePersonDisplayName(undefined)).toBe('');
  });
});
