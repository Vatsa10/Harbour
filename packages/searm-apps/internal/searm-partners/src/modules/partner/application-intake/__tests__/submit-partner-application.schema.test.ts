import { describe, expect, it } from 'vitest';

import { submitPartnerApplicationSchema } from '../services/submit-partner-application-input.schema';

const base = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  companyName: 'Analytical Engines',
};

describe('submitPartnerApplicationSchema', () => {
  it('accepts a minimal valid application', () => {
    expect(submitPartnerApplicationSchema.safeParse(base).success).toBe(true);
  });

  it('accepts the new partnerScope categories', () => {
    const result = submitPartnerApplicationSchema.safeParse({
      ...base,
      partnerScope: ['ADVISORY', 'SOLUTIONING', 'HOSTING'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects legacy / unknown partnerScope values', () => {
    expect(
      submitPartnerApplicationSchema.safeParse({ ...base, partnerScope: ['APPS'] })
        .success,
    ).toBe(false);
  });

  it('rejects an unknown typeOfTeam', () => {
    expect(
      submitPartnerApplicationSchema.safeParse({ ...base, typeOfTeam: 'FREELANCE' })
        .success,
    ).toBe(false);
  });

  it('rejects an unknown country but accepts a known one with languages', () => {
    expect(
      submitPartnerApplicationSchema.safeParse({ ...base, country: 'ATLANTIS' })
        .success,
    ).toBe(false);
    expect(
      submitPartnerApplicationSchema.safeParse({
        ...base,
        country: 'FRANCE',
        languages: ['ENGLISH', 'FRENCH'],
      }).success,
    ).toBe(true);
  });

  it('requires a non-empty email and companyName', () => {
    expect(
      submitPartnerApplicationSchema.safeParse({ ...base, email: '' }).success,
    ).toBe(false);
    expect(
      submitPartnerApplicationSchema.safeParse({ ...base, companyName: '' })
        .success,
    ).toBe(false);
  });

  it('accepts optional notes and commercials', () => {
    const result = submitPartnerApplicationSchema.safeParse({
      ...base,
      applicationNotes: 'Looking forward to partnering.',
      hourlyRate: 150,
      projectBudgetMin: 5000,
      skills: ['React', 'PostgreSQL'],
    });
    expect(result.success).toBe(true);
  });

  const validExperienceNotes =
    'Built a custom SeaRM app for a property-management client, modeled leases and ' +
    'tenants as data models, automated renewal workflows, and shipped a front component ' +
    'for the broker dashboard with role-based views.';

  it('accepts searm experience milestones, narrative, and proof link', () => {
    const result = submitPartnerApplicationSchema.safeParse({
      ...base,
      searmExperience: [
        'CUSTOM_APPS',
        'DATA_MODELS',
        'WORKFLOWS',
        'FRONT_COMPONENTS',
      ],
      searmExperienceNotes: validExperienceNotes,
      searmExperienceProofLink: 'https://www.loom.com/share/example',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown searmExperience milestone values', () => {
    expect(
      submitPartnerApplicationSchema.safeParse({
        ...base,
        searmExperience: ['INTEGRATIONS'],
        searmExperienceNotes: validExperienceNotes,
        searmExperienceProofLink: 'https://github.com/example/case',
      }).success,
    ).toBe(false);
  });

  it('rejects searmExperienceNotes shorter than 200 characters', () => {
    expect(
      submitPartnerApplicationSchema.safeParse({
        ...base,
        searmExperience: ['WORKFLOWS'],
        searmExperienceNotes: 'Too short for a real implementation narrative.',
        searmExperienceProofLink: 'https://www.loom.com/share/example',
      }).success,
    ).toBe(false);
  });

  it('rejects a partial experience triad', () => {
    expect(
      submitPartnerApplicationSchema.safeParse({
        ...base,
        searmExperience: ['WORKFLOWS'],
      }).success,
    ).toBe(false);
  });

  it('rejects a non-http searmExperienceProofLink', () => {
    expect(
      submitPartnerApplicationSchema.safeParse({
        ...base,
        searmExperience: ['WORKFLOWS'],
        searmExperienceNotes: validExperienceNotes,
        searmExperienceProofLink: 'javascript:alert(1)',
      }).success,
    ).toBe(false);
  });

  it('rejects an empty searmExperience array when other experience fields are set', () => {
    expect(
      submitPartnerApplicationSchema.safeParse({
        ...base,
        searmExperience: [],
        searmExperienceNotes: validExperienceNotes,
        searmExperienceProofLink: 'https://www.loom.com/share/example',
      }).success,
    ).toBe(false);
  });
});
