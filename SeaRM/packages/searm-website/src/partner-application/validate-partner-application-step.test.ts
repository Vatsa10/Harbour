import { INITIAL_PARTNER_APPLICATION_STATE } from './partner-application-state';
import { validatePartnerApplicationStep } from './validate-partner-application-step';

const validExperienceNotes =
  'Built a custom SeaRM app for a property-management client, modeled leases and ' +
  'tenants as data models, automated renewal workflows, and shipped a front component ' +
  'for the broker dashboard with role-based views.';

describe('validatePartnerApplicationStep', () => {
  it('requires experience milestones, narrative, and proof URL on Experience', () => {
    const errors = validatePartnerApplicationStep({
      ...INITIAL_PARTNER_APPLICATION_STATE,
      stepIndex: 3,
    });
    expect(errors.searmExperience).toBe('required');
    expect(errors.searmExperienceNotes).toBe('required');
    expect(errors.searmExperienceProofLink).toBe('required');
  });

  it('rejects a narrative under 200 characters on Experience', () => {
    const errors = validatePartnerApplicationStep({
      ...INITIAL_PARTNER_APPLICATION_STATE,
      stepIndex: 3,
      searmExperience: ['WORKFLOWS'],
      searmExperienceNotes: 'Too short for a real implementation narrative.',
      searmExperienceProofLink: 'https://www.loom.com/share/example',
    });
    expect(errors.searmExperienceNotes).toBe('too_short');
  });

  it('rejects an invalid proof URL on Experience', () => {
    const errors = validatePartnerApplicationStep({
      ...INITIAL_PARTNER_APPLICATION_STATE,
      stepIndex: 3,
      searmExperience: ['CUSTOM_APPS'],
      searmExperienceNotes: validExperienceNotes,
      searmExperienceProofLink: 'not-a-url',
    });
    expect(errors.searmExperienceProofLink).toBe('invalid_url');
  });

  it('accepts a complete Experience step', () => {
    const errors = validatePartnerApplicationStep({
      ...INITIAL_PARTNER_APPLICATION_STATE,
      stepIndex: 3,
      searmExperience: ['CUSTOM_APPS', 'DATA_MODELS'],
      searmExperienceNotes: validExperienceNotes,
      searmExperienceProofLink: 'https://www.loom.com/share/example',
    });
    expect(errors).toEqual({});
  });
});
