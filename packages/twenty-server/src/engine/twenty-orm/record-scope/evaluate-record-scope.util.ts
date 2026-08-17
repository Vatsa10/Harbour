import { type RecordScopeNode, type RecordScopeValue } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import {
  PermissionsException,
  PermissionsExceptionCode,
  PermissionsExceptionMessage,
} from 'src/engine/metadata-modules/permissions/permissions.exception';
import { type RecordScopePrincipal } from 'src/engine/twenty-orm/record-scope/types/record-scope-principal.type';

type EvaluateContext = {
  record: Record<string, unknown>;
  columnNamesByFieldMetadataId: Map<string, string[]>;
  principal: RecordScopePrincipal;
};

// SQL treats NULL and a missing column identically for our operators, and the
// post-image of a write often omits untouched columns, so both collapse to null
// here. Anything else would make the guard and the WHERE clause disagree.
const readColumn = (fieldMetadataId: string, context: EvaluateContext) => {
  const columnNames = context.columnNamesByFieldMetadataId.get(fieldMetadataId);

  if (!isDefined(columnNames) || columnNames.length !== 1) {
    throw new PermissionsException(
      PermissionsExceptionMessage.PERMISSION_DENIED,
      PermissionsExceptionCode.PERMISSION_DENIED,
    );
  }

  return context.record[columnNames[0]] ?? null;
};

const resolveValue = (value: RecordScopeValue, context: EvaluateContext) => {
  if (value.source === 'principal') {
    const resolved = context.principal[value.attribute];

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

const evaluateComparison = (
  node: Extract<RecordScopeNode, { type: 'comparison' }>,
  context: EvaluateContext,
): boolean => {
  const columnValue = readColumn(node.fieldMetadataId, context);

  if (node.operator === 'isNull') {
    return columnValue === null;
  }

  if (node.operator === 'isNotNull') {
    return columnValue !== null;
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

    // Mirrors `= ANY(...)`: a NULL column is never IN anything, and notIn
    // therefore admits it.
    const isMember = columnValue !== null && values.includes(columnValue as never);

    return node.operator === 'in' ? isMember : !isMember;
  }

  // IS DISTINCT FROM semantics, matching the renderer: null neq 'EMEA' is true.
  return node.operator === 'eq'
    ? columnValue === resolved
    : columnValue !== resolved;
};

export const evaluateRecordScope = ({
  node,
  record,
  columnNamesByFieldMetadataId,
  principal,
}: {
  node: RecordScopeNode;
  record: Record<string, unknown>;
  columnNamesByFieldMetadataId: Map<string, string[]>;
  principal: RecordScopePrincipal;
}): boolean => {
  const context: EvaluateContext = {
    record,
    columnNamesByFieldMetadataId,
    principal,
  };

  const walk = (current: RecordScopeNode): boolean => {
    switch (current.type) {
      case 'comparison':
        return evaluateComparison(current, context);
      case 'not':
        return !walk(current.child);
      case 'group':
        return current.operator === 'and'
          ? current.children.every(walk)
          : current.children.some(walk);
    }
  };

  return walk(node);
};
