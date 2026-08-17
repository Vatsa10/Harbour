import { type RecordScopeNode, type RecordScopeRule } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import {
  RECORD_SCOPE_DENY_ALL,
  RECORD_SCOPE_UNRESTRICTED,
  type CompiledRecordScope,
} from 'src/engine/twenty-orm/record-scope/types/compiled-record-scope.type';
import { type RecordScopePrincipal } from 'src/engine/twenty-orm/record-scope/types/record-scope-principal.type';

// Whole-rule resolvability, not per-node. A rule is one statement of intent by
// its author; evaluating half of it for a principal it was not written for is
// how `not(ownerId eq me)` turns into total access for an api key.
const isRuleResolvable = (
  node: RecordScopeNode,
  principal: RecordScopePrincipal,
): boolean => {
  switch (node.type) {
    case 'comparison':
      if (node.value?.source !== 'principal') {
        return true;
      }

      return isDefined(principal[node.value.attribute]);
    case 'group':
      return node.children.every((child) => isRuleResolvable(child, principal));
    case 'not':
      return isRuleResolvable(node.child, principal);
  }
};

export const compileRecordScope = ({
  recordScopeRules,
  principal,
}: {
  recordScopeRules: RecordScopeRule[];
  principal: RecordScopePrincipal;
}): CompiledRecordScope => {
  // Silence means every row. The object permission has already decided whether
  // this role touches the object at all; a scope only decides which rows.
  if (recordScopeRules.length === 0) {
    return RECORD_SCOPE_UNRESTRICTED;
  }

  const resolvableExpressions = recordScopeRules
    .filter((rule) => isRuleResolvable(rule.expression, principal))
    .map((rule) => rule.expression);

  // A role that *has* rules and can evaluate none of them must not fall open.
  if (resolvableExpressions.length === 0) {
    return RECORD_SCOPE_DENY_ALL;
  }

  if (resolvableExpressions.length === 1) {
    return { kind: 'expression', node: resolvableExpressions[0] };
  }

  // Rules within one (role, object) are grants, so they union. Adding a rule
  // can only widen; removing one can only narrow.
  return {
    kind: 'expression',
    node: { type: 'group', operator: 'or', children: resolvableExpressions },
  };
};
