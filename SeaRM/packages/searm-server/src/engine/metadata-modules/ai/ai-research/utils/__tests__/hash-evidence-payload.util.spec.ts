import { hashEvidencePayload } from 'src/engine/metadata-modules/ai/ai-research/utils/hash-evidence-payload.util';

describe('hashEvidencePayload', () => {
  it('should produce the same hash for the same payload', () => {
    const payload = { fieldName: 'employeeCount', value: '500' };

    expect(hashEvidencePayload(payload)).toBe(hashEvidencePayload(payload));
  });

  it('should produce a different hash when the value differs', () => {
    const a = hashEvidencePayload({ fieldName: 'employeeCount', value: '500' });
    const b = hashEvidencePayload({ fieldName: 'employeeCount', value: '600' });

    expect(a).not.toBe(b);
  });

  it('should produce a 64-character hex sha256 digest', () => {
    const hash = hashEvidencePayload({ fieldName: 'x', value: 'y' });

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
