import { isDefined } from 'twenty-shared/utils';

import { type RecordBriefFact } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
import {
  BRIEF_NARRATIVE_MAX_LENGTH,
  BRIEF_NARRATIVE_MIN_LENGTH,
  type BriefSections,
} from 'src/engine/metadata-modules/ai/ai-research/types/record-brief.type';

// The brief is composed from facts, not written by a model and then checked
// against them. That is a stronger form of the crm repo's evidence gate: a
// sentence that no CURRENT fact supports cannot be produced at all, so there
// is no unsourced-prose failure mode to detect. The cost is a plain voice,
// which the skill doc wanted anyway — third person, present tense, zero
// adjectives about the person.

// Only these fields can be narrated. An unrecognised field is left out rather
// than rendered as "fieldName: value", which would be a JSON dump with
// punctuation. Order here is the order of the sentences.
const NARRATABLE_FIELDS: {
  fieldName: string;
  section: string;
  sentence: (value: string, subject: string) => string;
}[] = [
  {
    fieldName: 'jobTitle',
    section: 'currentRole',
    sentence: (value, subject) => `${subject} is ${value}`,
  },
  {
    fieldName: 'companyName',
    section: 'company',
    sentence: (value, subject) => `${subject} works at ${value}`,
  },
  {
    fieldName: 'seniority',
    section: 'seniority',
    sentence: (value, subject) => `${subject} is at ${value} level`,
  },
  {
    fieldName: 'function',
    section: 'function',
    sentence: (value, subject) => `${subject} works in ${value}`,
  },
  {
    fieldName: 'tenure',
    section: 'tenure',
    sentence: (value, subject) => `${subject} has held the role ${value}`,
  },
  {
    fieldName: 'previousRoles',
    section: 'previousRoles',
    sentence: (value) => `Previously ${value}`,
  },
  {
    fieldName: 'city',
    section: 'location',
    sentence: (value) => `Based in ${value}`,
  },
  {
    fieldName: 'industry',
    section: 'industry',
    sentence: (value, subject) => `${subject} operates in ${value}`,
  },
  {
    fieldName: 'employees',
    section: 'employees',
    sentence: (value) => `Headcount ${value}`,
  },
];

// Fields used to name the subject. Never narrated as their own sentence — a
// brief whose only content is the record's own name is exactly the padding
// the length floor exists to reject.
const SUBJECT_FIELDS = ['name', 'fullName', 'firstName'];

// A fact earns a place in the brief when it is uncontradicted AND either
// server-observed (STRONG) or corroborated by a second observation. A single
// WEAK observation is enough to propose a field change a human reviews; it is
// not enough to state as background a rep will repeat on a call.
export const isBriefWorthy = (fact: RecordBriefFact): boolean =>
  !fact.hasConflict && (fact.strength === 'STRONG' || fact.evidenceCount >= 2);

const renderValue = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : null))
      .filter((entry): entry is string => isDefined(entry) && entry.length > 0);

    return parts.length > 0 ? parts.join(', ') : null;
  }

  // Booleans, objects and nulls have no honest one-line rendering.
  return null;
};

export type ComposedBrief = {
  narrative: string;
  sections: BriefSections;
  factIds: string[];
  oldestObservedAt: Date;
};

export const composeRecordBrief = (params: {
  facts: RecordBriefFact[];
  objectNameSingular: string;
}): ComposedBrief | null => {
  const worthy = params.facts.filter(isBriefWorthy);

  const byFieldName = new Map(worthy.map((fact) => [fact.fieldName, fact]));

  const subjectFact = SUBJECT_FIELDS.map((fieldName) =>
    byFieldName.get(fieldName),
  ).find(isDefined);

  const subject = isDefined(subjectFact)
    ? (renderValue(subjectFact.value) ?? `This ${params.objectNameSingular}`)
    : `This ${params.objectNameSingular}`;

  const sections: BriefSections = {};
  const factIds: string[] = [];
  const sentences: string[] = [];

  for (const narratable of NARRATABLE_FIELDS) {
    const fact = byFieldName.get(narratable.fieldName);

    if (!isDefined(fact)) {
      continue;
    }

    const rendered = renderValue(fact.value);

    if (!isDefined(rendered)) {
      continue;
    }

    const sentence = `${narratable.sentence(rendered, subject)}.`;

    // The ceiling is enforced by not adding the sentence that would breach it,
    // never by truncating: a brief cut mid-clause reads as a bug, and a brief
    // cut mid-number is wrong rather than short.
    const nextLength =
      sentences.join(' ').length + (sentences.length > 0 ? 1 : 0) +
      sentence.length;

    if (nextLength > BRIEF_NARRATIVE_MAX_LENGTH) {
      continue;
    }

    sentences.push(sentence);
    sections[narratable.section] = rendered;
    factIds.push(fact.id);
  }

  const narrative = sentences.join(' ');

  if (narrative.length < BRIEF_NARRATIVE_MIN_LENGTH) {
    return null;
  }

  const observedTimes = factIds
    .map((factId) => worthy.find((fact) => fact.id === factId)?.lastObservedAt)
    .filter(isDefined);

  return {
    narrative,
    sections,
    factIds,
    oldestObservedAt: new Date(
      Math.min(...observedTimes.map((observedAt) => observedAt.getTime())),
    ),
  };
};
