import { FieldMetadataType } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';

// Twenty already turns SELECT/MULTI_SELECT options into a zod enum of VALUES
// and validates against it at the same edge every write goes through — that
// half of the charter's "resolve option values" requirement is already
// solved and is not rebuilt here. This only fills what a field.description-less
// custom field is missing: the human-readable label behind each value, and,
// for relations, which object the ID belongs to.
export const describeCustomFieldForToolSchema = (
  field: Pick<
    FlatFieldMetadata,
    'name' | 'label' | 'type' | 'description' | 'options'
  >,
  relationTargetLabel?: string,
): string => {
  if (isDefined(field.description) && field.description.length > 0) {
    return field.description;
  }

  if (
    field.type === FieldMetadataType.SELECT ||
    field.type === FieldMetadataType.MULTI_SELECT
  ) {
    const options = (field.options ?? []) as {
      value: string;
      label: string;
    }[];

    if (options.length === 0) {
      return `Custom field "${field.label}".`;
    }

    const optionList = options
      .map((option) => `${option.label} (value: "${option.value}")`)
      .join(', ');

    const cardinality =
      field.type === FieldMetadataType.MULTI_SELECT
        ? 'one or more of'
        : 'exactly one of';

    return `Custom field "${field.label}". Pass ${cardinality}: ${optionList}.`;
  }

  if (
    field.type === FieldMetadataType.RELATION ||
    field.type === FieldMetadataType.MORPH_RELATION
  ) {
    if (!isDefined(relationTargetLabel)) {
      return `Custom field "${field.label}". This is a relation — the value must be the UUID of an existing target record.`;
    }

    return (
      `Custom field "${field.label}", linking to ${relationTargetLabel}. ` +
      `If you don't already know the target record's ID, call find_one_${relationTargetLabel} ` +
      `or find_many_${relationTargetLabel}s first to look it up — never guess an ID.`
    );
  }

  return `Custom field "${field.label}".`;
};
