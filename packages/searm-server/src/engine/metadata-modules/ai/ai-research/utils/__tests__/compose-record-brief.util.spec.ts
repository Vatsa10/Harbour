import { type RecordBriefFact } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
import {
  BRIEF_NARRATIVE_MAX_LENGTH,
  BRIEF_NARRATIVE_MIN_LENGTH,
} from 'src/engine/metadata-modules/ai/ai-research/types/record-brief.type';
import { composeRecordBrief } from 'src/engine/metadata-modules/ai/ai-research/utils/compose-record-brief.util';

const OBSERVED_AT = new Date('2026-01-01T00:00:00.000Z');

const fact = (overrides: Partial<RecordBriefFact>): RecordBriefFact => ({
  id: 'fact-1',
  fieldName: 'jobTitle',
  value: 'Head of Revenue Operations',
  strength: 'STRONG',
  hasConflict: false,
  lastObservedAt: OBSERVED_AT,
  evidenceCount: 1,
  ...overrides,
});

describe('composeRecordBrief', () => {
  it('should compose a narrative and sparse sections from strong facts', () => {
    const composed = composeRecordBrief({
      objectNameSingular: 'person',
      facts: [
        fact({ id: 'f-name', fieldName: 'name', value: 'Dana Okafor' }),
        fact({ id: 'f-title' }),
        fact({ id: 'f-city', fieldName: 'city', value: 'Lisbon' }),
      ],
    });

    expect(composed?.narrative).toBe(
      'Dana Okafor is Head of Revenue Operations. Based in Lisbon.',
    );
    // Sparse: only the fields actually sourced appear, no empty keys for the
    // sections nothing was known about.
    expect(composed?.sections).toEqual({
      currentRole: 'Head of Revenue Operations',
      location: 'Lisbon',
    });
    expect(composed?.factIds).toEqual(['f-title', 'f-city']);
  });

  it('should write nothing when every fact is a single weak observation', () => {
    const composed = composeRecordBrief({
      objectNameSingular: 'person',
      facts: [
        fact({ id: 'f-name', fieldName: 'name', value: 'Dana Okafor' }),
        fact({ id: 'f-title', strength: 'WEAK', evidenceCount: 1 }),
        fact({
          id: 'f-city',
          fieldName: 'city',
          value: 'Lisbon',
          strength: 'WEAK',
          evidenceCount: 1,
        }),
      ],
    });

    expect(composed).toBeNull();
  });

  it('should admit a weak fact once a second observation corroborates it', () => {
    const composed = composeRecordBrief({
      objectNameSingular: 'person',
      facts: [
        fact({ id: 'f-title', strength: 'WEAK', evidenceCount: 2 }),
        fact({
          id: 'f-city',
          fieldName: 'city',
          value: 'Lisbon',
          strength: 'WEAK',
          evidenceCount: 2,
        }),
      ],
    });

    expect(composed?.narrative).toBe(
      'This person is Head of Revenue Operations. Based in Lisbon.',
    );
  });

  it('should exclude a conflicted fact even when it is strong', () => {
    const composed = composeRecordBrief({
      objectNameSingular: 'person',
      facts: [
        fact({ id: 'f-title', hasConflict: true }),
        fact({
          id: 'f-company',
          fieldName: 'companyName',
          value: 'Meridian Freight Systems',
        }),
      ],
    });

    expect(composed?.narrative).toBe(
      'This person works at Meridian Freight Systems.',
    );
    expect(composed?.sections.currentRole).toBeUndefined();
    expect(composed?.factIds).toEqual(['f-company']);
  });

  it('should write nothing when the only sourced content is below the length floor', () => {
    const composed = composeRecordBrief({
      objectNameSingular: 'person',
      facts: [fact({ id: 'f-city', fieldName: 'city', value: 'Rome' })],
    });

    expect('Based in Rome.'.length).toBeLessThan(BRIEF_NARRATIVE_MIN_LENGTH);
    expect(composed).toBeNull();
  });

  it('should stay under the ceiling by dropping whole sentences, never truncating one', () => {
    const long = 'Global Head of Strategic Revenue Operations and Enablement';

    const composed = composeRecordBrief({
      objectNameSingular: 'person',
      facts: [
        fact({ id: 'f-title', value: long }),
        fact({ id: 'f-company', fieldName: 'companyName', value: long }),
        fact({ id: 'f-seniority', fieldName: 'seniority', value: long }),
        fact({ id: 'f-function', fieldName: 'function', value: long }),
        fact({ id: 'f-tenure', fieldName: 'tenure', value: long }),
        fact({ id: 'f-city', fieldName: 'city', value: long }),
        fact({ id: 'f-industry', fieldName: 'industry', value: long }),
      ],
    });

    expect(composed?.narrative.length).toBeLessThanOrEqual(
      BRIEF_NARRATIVE_MAX_LENGTH,
    );
    // Every sentence that survived is complete: the last character is a full
    // stop and no sentence body was cut.
    expect(composed?.narrative.endsWith('.')).toBe(true);
    for (const sentence of (composed?.narrative ?? '').split('. ')) {
      expect(sentence).toContain(long);
    }
    // Dropped sentences leave no orphan section entry behind.
    expect(Object.keys(composed?.sections ?? {}).length).toBe(
      composed?.factIds.length,
    );
  });

  it('should skip values that have no honest one-line rendering', () => {
    const composed = composeRecordBrief({
      objectNameSingular: 'person',
      facts: [
        fact({ id: 'f-title', value: { label: 'CFO' } }),
        fact({ id: 'f-company', fieldName: 'companyName', value: '   ' }),
        fact({
          id: 'f-previous',
          fieldName: 'previousRoles',
          value: ['Director of Sales Operations', 'Sales Manager'],
        }),
      ],
    });

    expect(composed?.narrative).toBe(
      'Previously Director of Sales Operations, Sales Manager.',
    );
  });

  it('should report the oldest observation behind the brief, not the newest', () => {
    const composed = composeRecordBrief({
      objectNameSingular: 'person',
      facts: [
        fact({ id: 'f-title', lastObservedAt: new Date('2025-03-04') }),
        fact({
          id: 'f-city',
          fieldName: 'city',
          value: 'Lisbon',
          lastObservedAt: new Date('2026-07-09'),
        }),
      ],
    });

    expect(composed?.oldestObservedAt).toEqual(new Date('2025-03-04'));
  });
});
