'use client';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';

import { ChipMultiSelect, Field, TextareaField, TextField } from '@/ui';

import { PARTNER_SEARM_EXPERIENCE_OPTIONS } from '../../data/partner-searm-experience-options';
import { PARTNER_APPLICATION_COPY } from '../../partner-application-copy';
import { type PartnerApplicationController } from '../../use-partner-application-state';

const FIELDS = PARTNER_APPLICATION_COPY.fields;

export function ExperienceStep({
  controller,
}: {
  controller: PartnerApplicationController;
}) {
  const { i18n } = useLingui();
  const { setField, state, toggleExperience } = controller;

  const experienceOptions = PARTNER_SEARM_EXPERIENCE_OPTIONS.map((option) => ({
    label: i18n._(option.label),
    value: option.value,
  }));

  return (
    <>
      <Field
        hint={i18n._(FIELDS.searmExperienceHint)}
        label={i18n._(FIELDS.searmExperience)}
      >
        <ChipMultiSelect
          ariaLabel={i18n._(FIELDS.searmExperience)}
          invalid={state.fieldErrors.searmExperience !== undefined}
          onToggle={toggleExperience}
          options={experienceOptions}
          values={state.searmExperience}
        />
      </Field>
      <Field
        hint={i18n._(FIELDS.searmExperienceNotesHint)}
        label={i18n._(FIELDS.searmExperienceNotes)}
      >
        <TextareaField
          ariaLabel={i18n._(FIELDS.searmExperienceNotes)}
          invalid={state.fieldErrors.searmExperienceNotes !== undefined}
          name="searmExperienceNotes"
          onValueChange={(value) => setField('searmExperienceNotes', value)}
          placeholder={i18n._(FIELDS.searmExperienceNotesPlaceholder)}
          value={state.searmExperienceNotes}
        />
      </Field>
      <Field
        hint={i18n._(FIELDS.searmExperienceProofLinkHint)}
        label={i18n._(FIELDS.searmExperienceProofLink)}
      >
        <TextField
          ariaLabel={i18n._(FIELDS.searmExperienceProofLink)}
          inputMode="url"
          invalid={state.fieldErrors.searmExperienceProofLink !== undefined}
          name="searmExperienceProofLink"
          onValueChange={(value) =>
            setField('searmExperienceProofLink', value)
          }
          placeholder={i18n._(msg`https://`)}
          value={state.searmExperienceProofLink}
        />
      </Field>
    </>
  );
}
