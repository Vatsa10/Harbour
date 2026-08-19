// SeaRM: clean-room AGPL-3.0 rewrite. See
// .superpowers/sdd/enterprise-rewrite/rlp-recon.md for design notes.
// In-memory evaluation of a resolved row level permission record filter
// against a single already-fetched record (used for post-write validation,
// not for building SQL). A soft-deleted record only matches when the filter
// explicitly targets deletedAt — otherwise it's treated as invisible, same
// as the SQL path's implicit "not deleted" behaviour.
import { isDefined } from 'twenty-shared/utils';
import { FieldMetadataType } from 'twenty-shared/types';

type MatchableRecord = object;

import { isCompositeFieldMetadataType } from 'src/engine/metadata-modules/field-metadata/utils/is-composite-field-metadata-type.util';
import { findFlatEntityByIdInFlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-id-in-flat-entity-maps.util';
import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';

const LOGICAL_KEYS = new Set(['and', 'or', 'not']);

const applyOperator = (
  actualValue: unknown,
  operator: string,
  expected: unknown,
): boolean => {
  switch (operator) {
    case 'eq':
      return actualValue === expected;
    case 'is':
      return expected === 'NULL' ? !isDefined(actualValue) : isDefined(actualValue);
    case 'gte':
      return isDefined(actualValue) && (actualValue as number) >= (expected as number);
    case 'lte':
      return isDefined(actualValue) && (actualValue as number) <= (expected as number);
    case 'ilike': {
      if (!isDefined(actualValue)) {
        return false;
      }

      const pattern = String(expected).replace(/%/g, '').toLowerCase();

      return String(actualValue).toLowerCase().includes(pattern);
    }
    case 'in':
      return Array.isArray(expected) && expected.includes(actualValue);
    default:
      return false;
  }
};

const matchesOperatorCondition = (
  actualValue: unknown,
  condition: Record<string, unknown>,
): boolean =>
  Object.entries(condition).every(([operator, expected]) =>
    applyOperator(actualValue, operator, expected),
  );

type FieldLookup = {
  byName: Map<string, FlatFieldMetadata>;
  byJoinColumnName: Map<string, FlatFieldMetadata>;
};

const buildFieldLookup = ({
  flatObjectMetadata,
  flatFieldMetadataMaps,
}: {
  flatObjectMetadata: FlatObjectMetadata;
  flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata>;
}): FieldLookup => {
  const byName = new Map<string, FlatFieldMetadata>();
  const byJoinColumnName = new Map<string, FlatFieldMetadata>();

  for (const fieldId of flatObjectMetadata.fieldIds) {
    const fieldMetadata = findFlatEntityByIdInFlatEntityMaps({
      flatEntityId: fieldId,
      flatEntityMaps: flatFieldMetadataMaps,
    });

    if (!isDefined(fieldMetadata)) {
      continue;
    }

    byName.set(fieldMetadata.name, fieldMetadata);

    if (fieldMetadata.type === FieldMetadataType.RELATION) {
      const joinColumnName = (
        fieldMetadata.settings as { joinColumnName?: string } | undefined
      )?.joinColumnName;

      if (isDefined(joinColumnName)) {
        byJoinColumnName.set(joinColumnName, fieldMetadata);
      }
    }
  }

  return { byName, byJoinColumnName };
};

const matchesFieldCondition = ({
  record,
  key,
  value,
  fieldLookup,
}: {
  record: MatchableRecord;
  key: string;
  value: unknown;
  fieldLookup: FieldLookup;
}): boolean => {
  const joinColumnField = fieldLookup.byJoinColumnName.get(key);

  if (isDefined(joinColumnField)) {
    return matchesOperatorCondition(
      (record as Record<string, unknown>)[key],
      value as Record<string, unknown>,
    );
  }

  const fieldMetadata = fieldLookup.byName.get(key);

  if (!isDefined(fieldMetadata)) {
    return false;
  }

  if (fieldMetadata.type === FieldMetadataType.RELATION) {
    const relatedRecord = (record as Record<string, unknown>)[key] as
      | { id?: string }
      | null
      | undefined;

    return matchesOperatorCondition(
      relatedRecord?.id,
      value as Record<string, unknown>,
    );
  }

  if (isCompositeFieldMetadataType(fieldMetadata.type)) {
    const compositeValue = (record as Record<string, unknown>)[key] as
      | Record<string, unknown>
      | null
      | undefined;

    // At least one sub field matching is enough: predicates on composite
    // fields describe "this composite value looks like X", not "every
    // sub field independently satisfies X".
    return Object.entries(value as Record<string, unknown>).some(
      ([subFieldKey, subFieldCondition]) =>
        matchesOperatorCondition(
          compositeValue?.[subFieldKey],
          subFieldCondition as Record<string, unknown>,
        ),
    );
  }

  return matchesOperatorCondition(
    (record as Record<string, unknown>)[key],
    value as Record<string, unknown>,
  );
};

const matchesFilterObject = ({
  record,
  filter,
  fieldLookup,
}: {
  record: MatchableRecord;
  filter: Record<string, unknown>;
  fieldLookup: FieldLookup;
}): boolean =>
  Object.entries(filter).every(([key, value]) => {
    if (key === 'not') {
      return !matchesFilterObject({
        record,
        filter: value as Record<string, unknown>,
        fieldLookup,
      });
    }

    if (key === 'and' || key === 'or') {
      if (Array.isArray(value)) {
        const evaluated = value.map((subFilter) =>
          matchesFilterObject({
            record,
            filter: subFilter as Record<string, unknown>,
            fieldLookup,
          }),
        );

        return key === 'and'
          ? evaluated.every(Boolean)
          : evaluated.some(Boolean);
      }

      // A non-array "or"/"and" value is a single filter object whose own
      // keys are ANDed together, same as any other nested filter object.
      return matchesFilterObject({
        record,
        filter: value as Record<string, unknown>,
        fieldLookup,
      });
    }

    if (LOGICAL_KEYS.has(key)) {
      return false;
    }

    return matchesFieldCondition({ record, key, value, fieldLookup });
  });

export const isRecordMatchingRLSRowLevelPermissionPredicate = ({
  record,
  filter,
  flatObjectMetadata,
  flatFieldMetadataMaps,
  shouldIgnoreSoftDeleteDefaultFilter = false,
}: {
  record: MatchableRecord;
  filter: Record<string, unknown>;
  flatObjectMetadata: FlatObjectMetadata;
  flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata>;
  shouldIgnoreSoftDeleteDefaultFilter?: boolean;
}): boolean => {
  const isSoftDeleted = isDefined(
    (record as unknown as { deletedAt: unknown }).deletedAt,
  );

  if (
    !shouldIgnoreSoftDeleteDefaultFilter &&
    isSoftDeleted &&
    !Object.prototype.hasOwnProperty.call(filter, 'deletedAt')
  ) {
    return false;
  }

  const fieldLookup = buildFieldLookup({
    flatObjectMetadata,
    flatFieldMetadataMaps,
  });

  return matchesFilterObject({ record, filter, fieldLookup });
};
