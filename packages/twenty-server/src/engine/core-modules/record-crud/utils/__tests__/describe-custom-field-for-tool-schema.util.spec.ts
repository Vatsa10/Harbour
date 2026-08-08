import { FieldMetadataType } from 'twenty-shared/types';

import { describeCustomFieldForToolSchema } from 'src/engine/core-modules/record-crud/utils/describe-custom-field-for-tool-schema.util';

type TestField = Parameters<typeof describeCustomFieldForToolSchema>[0];

const baseField: TestField = {
  name: 'industry',
  label: 'Industry',
  type: FieldMetadataType.SELECT,
  description: null,
  options: null,
} as TestField;

describe('describeCustomFieldForToolSchema', () => {
  it('should return the existing description unchanged when one is set', () => {
    const field = { ...baseField, description: 'The lead source industry.' };

    expect(describeCustomFieldForToolSchema(field)).toBe(
      'The lead source industry.',
    );
  });

  it('should list label/value pairs for a SELECT field with no description', () => {
    const field = {
      ...baseField,
      options: [
        { value: 'SAAS', label: 'SaaS' },
        { value: 'FINTECH', label: 'Fintech' },
      ],
    } as TestField;

    const description = describeCustomFieldForToolSchema(field);

    expect(description).toContain('Industry');
    expect(description).toContain('SaaS (value: "SAAS")');
    expect(description).toContain('Fintech (value: "FINTECH")');
  });

  it('should describe a MULTI_SELECT field as accepting several values', () => {
    const field = {
      ...baseField,
      type: FieldMetadataType.MULTI_SELECT,
      options: [{ value: 'A', label: 'A label' }],
    } as TestField;

    expect(describeCustomFieldForToolSchema(field)).toContain(
      'one or more of',
    );
  });

  it('should point a RELATION field at the target object and instruct a lookup first', () => {
    const field = {
      ...baseField,
      type: FieldMetadataType.RELATION,
      options: null,
    };

    const description = describeCustomFieldForToolSchema(field, 'opportunity');

    expect(description).toContain('opportunity');
    expect(description).toContain('find_one_opportunity');
  });

  it('should fall back to a plain label-based description for other custom field types with no description', () => {
    const field = { ...baseField, type: FieldMetadataType.TEXT, options: null };

    expect(describeCustomFieldForToolSchema(field)).toBe(
      'Custom field "Industry".',
    );
  });
});
