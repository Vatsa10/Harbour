import { type RecordScopeNode, type RecordScopeValue } from 'searm-shared/types';
import { isDefined } from 'searm-shared/utils';

import {
  PermissionsException,
  PermissionsExceptionCode,
  PermissionsExceptionMessage,
} from 'src/engine/metadata-modules/permissions/permissions.exception';
import { type RecordScopePrincipal } from 'src/engine/searm-orm/record-scope/types/record-scope-principal.type';

export type RenderedRecordScope = {
  sql: string;
  parameters: Record<string, unknown>;
};

type RenderContext = {
  tableAlias: string;
  // Produced by getFieldMetadataIdToColumnNamesMap. Passed in rather than
  // recomputed here so the renderer stays a pure string function that a unit
  // test can drive without assembling a whole flat metadata graph.
  columnNamesByFieldMetadataId: Map<string, string[]>;
  principal: RecordScopePrincipal;
  parameterPrefix: string;
  parameters: Record<string, unknown>;
  // Threaded through the recursion rather than held module-level: a single
  // query renders the scope once per alias and the parameter namespace is flat.
  counter: { next: number };
};

const resolveColumn = (fieldMetadataId: string, context: RenderContext) => {
  const columnNames = context.columnNamesByFieldMetadataId.get(fieldMetadataId);

  // A composite field maps to several columns and a rule naming one has no
  // single truth value. The validator rejects those at write time, so reaching
  // here means the metadata changed underneath a stored rule. Fail closed and
  // loudly: the alternative is a field rename silently unscoping an object.
  if (!isDefined(columnNames) || columnNames.length !== 1) {
    throw new PermissionsException(
      PermissionsExceptionMessage.PERMISSION_DENIED,
      PermissionsExceptionCode.PERMISSION_DENIED,
    );
  }

  return `"${context.tableAlias}"."${columnNames[0]}"`;
};

const bind = (value: unknown, context: RenderContext): string => {
  const name = `${context.parameterPrefix}_${context.counter.next}`;

  context.counter.next += 1;
  context.parameters[name] = value;

  return `:${name}`;
};

const resolveValue = (value: RecordScopeValue, context: RenderContext) => {
  if (value.source === 'principal') {
    const resolved = context.principal[value.attribute];

    // compileRecordScope has already dropped any rule referencing a missing
    // attribute, so this is a contract violation rather than a normal miss.
    if (!isDefined(resolved)) {
      throw new PermissionsException(
        PermissionsExceptionMessage.PERMISSION_DENIED,
        PermissionsExceptionCode.PERMISSION_DENIED,
      );
    }

    return resolved;
  }

  return value.source === 'literalList' ? value.values : value.value;
};

const renderComparison = (
  node: Extract<RecordScopeNode, { type: 'comparison' }>,
  context: RenderContext,
): string => {
  const column = resolveColumn(node.fieldMetadataId, context);

  if (node.operator === 'isNull') {
    return `(${column} IS NULL)`;
  }

  if (node.operator === 'isNotNull') {
    return `(${column} IS NOT NULL)`;
  }

  if (!isDefined(node.value)) {
    throw new PermissionsException(
      PermissionsExceptionMessage.PERMISSION_DENIED,
      PermissionsExceptionCode.PERMISSION_DENIED,
    );
  }

  const resolved = resolveValue(node.value, context);

  if (node.operator === 'in' || node.operator === 'notIn') {
    const values = Array.isArray(resolved) ? resolved : [resolved];

    // An empty allow-list matches nothing; an empty deny-list excludes nothing.
    // Rendering `= ANY('{}')` would be correct for `in` but pointlessly costly,
    // and the notIn case must additionally let NULL through.
    if (values.length === 0) {
      return node.operator === 'in' ? '(FALSE)' : '(TRUE)';
    }

    const parameter = bind(values, context);

    // Every comparison must be two-valued. `NULL = ANY(...)` is NULL, and a
    // NULL under a NOT stays NULL, so the row silently drops out of a rule the
    // in-memory evaluator would have matched.
    return node.operator === 'in'
      ? `(${column} IS NOT NULL AND ${column} = ANY(${parameter}))`
      : `(${column} IS NULL OR NOT (${column} = ANY(${parameter})))`;
  }

  // `= NULL` is never true in SQL, so an eq against a null literal has to
  // become IS NULL or the rule silently matches no row at all.
  if (resolved === null) {
    return node.operator === 'eq'
      ? `(${column} IS NULL)`
      : `(${column} IS NOT NULL)`;
  }

  const parameter = bind(resolved, context);

  // IS NOT DISTINCT FROM / IS DISTINCT FROM rather than = / <>: both are
  // two-valued, so a NULL column yields FALSE / TRUE instead of NULL. Plain
  // `=` would return NULL here, and a NULL under a NOT stays NULL, which is
  // where naive SQL and naive JavaScript disagree and where a user ends up
  // writing a row they cannot then read.
  return node.operator === 'eq'
    ? `(${column} IS NOT DISTINCT FROM ${parameter})`
    : `(${column} IS DISTINCT FROM ${parameter})`;
};

const renderNode = (node: RecordScopeNode, context: RenderContext): string => {
  switch (node.type) {
    case 'comparison':
      return renderComparison(node, context);
    case 'not':
      return `(NOT ${renderNode(node.child, context)})`;
    case 'group': {
      if (node.children.length === 0) {
        // Identity elements: AND over nothing is true, OR over nothing is
        // false. The validator rejects empty groups, so this is depth only.
        return node.operator === 'and' ? '(TRUE)' : '(FALSE)';
      }

      const rendered = node.children.map((child) => renderNode(child, context));

      return `(${rendered.join(node.operator === 'and' ? ' AND ' : ' OR ')})`;
    }
  }
};

export const renderRecordScopeToSql = ({
  node,
  tableAlias,
  columnNamesByFieldMetadataId,
  principal,
  parameterPrefix,
}: {
  node: RecordScopeNode;
  tableAlias: string;
  columnNamesByFieldMetadataId: Map<string, string[]>;
  principal: RecordScopePrincipal;
  parameterPrefix: string;
}): RenderedRecordScope => {
  const context: RenderContext = {
    tableAlias,
    columnNamesByFieldMetadataId,
    principal,
    parameterPrefix,
    parameters: {},
    counter: { next: 0 },
  };

  const sql = renderNode(node, context);

  return { sql, parameters: context.parameters };
};
