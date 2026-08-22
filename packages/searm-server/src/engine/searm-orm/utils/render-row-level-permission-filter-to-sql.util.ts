// SeaRM: clean-room AGPL-3.0 rewrite. See
// .superpowers/sdd/enterprise-rewrite/rlp-recon.md for design notes.
// Renders a resolved row-level-permission record filter (a RecordGqlOperationFilter-
// shaped object, already restricted to a single object's fields) into a raw
// SQL fragment plus TypeORM parameters. Never called with attacker-controlled
// field names: the filter is built server-side from stored predicates.
import { capitalize, isDefined } from 'searm-shared/utils';
import {
  compositeTypeDefinitions,
  FieldMetadataType,
  type RecordGqlOperationFilter,
} from 'searm-shared/types';
import { type ObjectLiteral } from 'typeorm';
import { randomBytes } from 'crypto';

import { type CompositeFieldMetadataType } from 'src/engine/metadata-modules/field-metadata/types/composite-field-metadata-type.type';
import { isCompositeFieldMetadataType } from 'src/engine/metadata-modules/field-metadata/utils/is-composite-field-metadata-type.util';
import { findFlatEntityByIdInFlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-id-in-flat-entity-maps.util';
import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';

export type RenderedRowLevelPermissionFilter = {
  sql: string;
  parameters: ObjectLiteral;
};

type SupportedOperator = 'eq' | 'ilike' | 'gte' | 'lte' | 'in' | 'is';

const LOGICAL_OPERATORS = ['and', 'or', 'not'] as const;

const generateParameterKey = (columnName: string): string =>
  `${columnName}${randomBytes(5).toString('hex')}`;

const quoteColumn = (tableAlias: string | undefined, columnName: string) =>
  isDefined(tableAlias)
    ? `"${tableAlias}"."${columnName}"`
    : `"${columnName}"`;

const combine = (chunks: string[], operator: 'AND' | 'OR'): string => {
  if (chunks.length === 0) {
    return '1=1';
  }

  if (chunks.length === 1) {
    return chunks[0];
  }

  return `(${chunks.join(` ${operator} `)})`;
};

// Explicit "and"/"or" keys always wrap their rendered list in its own group
// parens, even for a single-item list — this is what marks it as a group
// distinct from its (possibly single) member, matching TypeORM's own
// Brackets behaviour. An empty list is the one exception: it renders as the
// bare always-true literal, same as TypeORM's empty Brackets.
const combineLogicalGroup = (chunks: string[], operator: 'AND' | 'OR'): string => {
  if (chunks.length === 0) {
    return '1=1';
  }

  return `(${chunks.join(` ${operator} `)})`;
};

const renderOperatorLeaf = ({
  tableAlias,
  columnName,
  operator,
  value,
  parameters,
}: {
  tableAlias: string | undefined;
  columnName: string;
  operator: SupportedOperator;
  value: unknown;
  parameters: ObjectLiteral;
}): string => {
  const columnRef = quoteColumn(tableAlias, columnName);

  switch (operator) {
    case 'is': {
      return value === 'NULL'
        ? `(${columnRef} IS NULL)`
        : `(${columnRef} IS NOT NULL)`;
    }
    case 'in': {
      if (!Array.isArray(value) || value.length === 0) {
        throw new Error(
          `Expected non-empty array for operator "in" on column "${columnName}"`,
        );
      }

      const parameterKey = generateParameterKey(columnName);

      parameters[parameterKey] = value;

      return `(${columnRef} IN (:...${parameterKey}))`;
    }
    case 'ilike': {
      const parameterKey = generateParameterKey(columnName);

      parameters[parameterKey] = value;

      return `(${columnRef}::text ILIKE :${parameterKey})`;
    }
    case 'gte': {
      const parameterKey = generateParameterKey(columnName);

      parameters[parameterKey] = value;

      return `(${columnRef} >= :${parameterKey})`;
    }
    case 'lte': {
      const parameterKey = generateParameterKey(columnName);

      parameters[parameterKey] = value;

      return `(${columnRef} <= :${parameterKey})`;
    }
    case 'eq': {
      const parameterKey = generateParameterKey(columnName);

      parameters[parameterKey] = value;

      return `(${columnRef} = :${parameterKey})`;
    }
    default: {
      throw new Error(`Unsupported row level permission operator`);
    }
  }
};

type FieldLookup = {
  byName: Map<string, FlatFieldMetadata>;
  byJoinColumnName: Map<string, FlatFieldMetadata>;
};

const buildFieldLookup = ({
  objectMetadata,
  flatFieldMetadataMaps,
}: {
  objectMetadata: FlatObjectMetadata;
  flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata>;
}): FieldLookup => {
  const byName = new Map<string, FlatFieldMetadata>();
  const byJoinColumnName = new Map<string, FlatFieldMetadata>();

  for (const fieldId of objectMetadata.fieldIds) {
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

const renderFieldCondition = ({
  tableAlias,
  key,
  value,
  fieldLookup,
  parameters,
}: {
  tableAlias: string | undefined;
  key: string;
  value: unknown;
  fieldLookup: FieldLookup;
  parameters: ObjectLiteral;
}): string => {
  const joinColumnField = fieldLookup.byJoinColumnName.get(key);

  if (isDefined(joinColumnField)) {
    return combine(
      Object.entries(value as Record<string, unknown>).map(
        ([operator, operatorValue]) =>
          renderOperatorLeaf({
            tableAlias,
            columnName: key,
            operator: operator as SupportedOperator,
            value: operatorValue,
            parameters,
          }),
      ),
      'AND',
    );
  }

  const fieldMetadata = fieldLookup.byName.get(key);

  if (!isDefined(fieldMetadata)) {
    throw new Error(`Row level permission predicate: field "${key}" does not exist on the object`);
  }

  if (fieldMetadata.type === FieldMetadataType.RELATION) {
    throw new Error(
      `Row level permission predicate on field "${key}": traversing a relation requires an additional join, reference the join column instead`,
    );
  }

  if (isCompositeFieldMetadataType(fieldMetadata.type)) {
    const compositeType = compositeTypeDefinitions.get(
      fieldMetadata.type as CompositeFieldMetadataType,
    );

    if (!isDefined(compositeType)) {
      throw new Error(
        `Composite type definition not found for type: ${fieldMetadata.type}`,
      );
    }

    return combine(
      Object.entries(value as Record<string, unknown>).map(
        ([subFieldKey, subFieldFilter]) => {
          const subFieldMetadata = compositeType.properties.find(
            (property) => property.name === subFieldKey,
          );

          if (!isDefined(subFieldMetadata)) {
            throw new Error(
              `"${subFieldKey}" is not a sub field of composite type "${fieldMetadata.type}"`,
            );
          }

          const columnName = `${fieldMetadata.name}${capitalize(subFieldKey)}`;

          return combine(
            Object.entries(subFieldFilter as Record<string, unknown>).map(
              ([operator, operatorValue]) =>
                renderOperatorLeaf({
                  tableAlias,
                  columnName,
                  operator: operator as SupportedOperator,
                  value: operatorValue,
                  parameters,
                }),
            ),
            'AND',
          );
        },
      ),
      'AND',
    );
  }

  return combine(
    Object.entries(value as Record<string, unknown>).map(
      ([operator, operatorValue]) =>
        renderOperatorLeaf({
          tableAlias,
          columnName: fieldMetadata.name,
          operator: operator as SupportedOperator,
          value: operatorValue,
          parameters,
        }),
    ),
    'AND',
  );
};

const renderFilterObject = ({
  tableAlias,
  filter,
  fieldLookup,
  parameters,
}: {
  tableAlias: string | undefined;
  filter: Record<string, unknown>;
  fieldLookup: FieldLookup;
  parameters: ObjectLiteral;
}): string => {
  const chunks = Object.entries(filter).map(([key, value]) => {
    if (key === 'and' || key === 'or') {
      const list = Array.isArray(value) ? value : [value];

      return combineLogicalGroup(
        list.map((subFilter) =>
          renderFilterObject({
            tableAlias,
            filter: subFilter as Record<string, unknown>,
            fieldLookup,
            parameters,
          }),
        ),
        key === 'and' ? 'AND' : 'OR',
      );
    }

    if (key === 'not') {
      const inner = renderFilterObject({
        tableAlias,
        filter: value as Record<string, unknown>,
        fieldLookup,
        parameters,
      });

      return `NOT (${inner})`;
    }

    if ((LOGICAL_OPERATORS as readonly string[]).includes(key)) {
      throw new Error(`Unsupported logical operator "${key}"`);
    }

    return renderFieldCondition({
      tableAlias,
      key,
      value,
      fieldLookup,
      parameters,
    });
  });

  return combine(chunks, 'AND');
};

export const renderRowLevelPermissionFilterToSql = ({
  tableAlias,
  objectMetadata,
  flatFieldMetadataMaps,
  recordFilter,
}: {
  tableAlias?: string;
  objectMetadata: FlatObjectMetadata;
  flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata>;
  recordFilter: RecordGqlOperationFilter;
}): RenderedRowLevelPermissionFilter | null => {
  if (Object.keys(recordFilter).length === 0) {
    return null;
  }

  const fieldLookup = buildFieldLookup({ objectMetadata, flatFieldMetadataMaps });
  const parameters: ObjectLiteral = {};

  const sql = renderFilterObject({
    tableAlias,
    filter: recordFilter as unknown as Record<string, unknown>,
    fieldLookup,
    parameters,
  });

  return { sql, parameters };
};
