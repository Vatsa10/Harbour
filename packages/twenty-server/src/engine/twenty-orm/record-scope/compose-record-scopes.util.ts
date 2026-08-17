import {
  type ObjectsPermissionsByRoleId,
  type RecordScopeNode,
} from 'twenty-shared/types';

import { type RolePermissionConfig } from 'src/engine/twenty-orm/types/role-permission-config';
import { compileRecordScope } from 'src/engine/twenty-orm/record-scope/compile-record-scope.util';
import {
  RECORD_SCOPE_DENY_ALL,
  RECORD_SCOPE_UNRESTRICTED,
  type CompiledRecordScope,
} from 'src/engine/twenty-orm/record-scope/types/compiled-record-scope.type';
import { type RecordScopePrincipal } from 'src/engine/twenty-orm/record-scope/types/record-scope-principal.type';

const compileForRole = ({
  roleId,
  rolesPermissions,
  objectMetadataId,
  principal,
}: {
  roleId: string;
  rolesPermissions: ObjectsPermissionsByRoleId;
  objectMetadataId: string;
  principal: RecordScopePrincipal;
}): CompiledRecordScope => {
  const objectsPermissions = rolesPermissions[roleId];

  // An unresolvable bound denies, matching how the object-level permission
  // lookup already treats a role id it cannot find.
  if (objectsPermissions === undefined) {
    return RECORD_SCOPE_DENY_ALL;
  }

  return compileRecordScope({
    recordScopeRules: objectsPermissions[objectMetadataId]?.recordScopeRules ?? [],
    principal,
  });
};

// Union of roles is union of grants: one unrestricted role genuinely does
// grant every row, and a denyAll role simply contributes nothing.
const unionScopes = (scopes: CompiledRecordScope[]): CompiledRecordScope => {
  if (scopes.some((scope) => scope.kind === 'unrestricted')) {
    return RECORD_SCOPE_UNRESTRICTED;
  }

  const nodes = scopes.flatMap((scope): RecordScopeNode[] =>
    scope.kind === 'expression' ? [scope.node] : [],
  );

  if (nodes.length === 0) {
    return RECORD_SCOPE_DENY_ALL;
  }

  if (nodes.length === 1) {
    return { kind: 'expression', node: nodes[0] };
  }

  return {
    kind: 'expression',
    node: { type: 'group', operator: 'or', children: nodes },
  };
};

// Intersection of roles is intersection of grants, so a deny from any bound
// survives and an unrestricted bound contributes `true` rather than widening.
const intersectScopes = (scopes: CompiledRecordScope[]): CompiledRecordScope => {
  if (scopes.some((scope) => scope.kind === 'denyAll')) {
    return RECORD_SCOPE_DENY_ALL;
  }

  const nodes = scopes.flatMap((scope): RecordScopeNode[] =>
    scope.kind === 'expression' ? [scope.node] : [],
  );

  if (nodes.length === 0) {
    return RECORD_SCOPE_UNRESTRICTED;
  }

  if (nodes.length === 1) {
    return { kind: 'expression', node: nodes[0] };
  }

  return {
    kind: 'expression',
    node: { type: 'group', operator: 'and', children: nodes },
  };
};

export const composeRecordScopes = ({
  rolePermissionConfig,
  rolesPermissions,
  objectMetadataId,
  principal,
}: {
  rolePermissionConfig: RolePermissionConfig | null;
  rolesPermissions: ObjectsPermissionsByRoleId;
  objectMetadataId: string;
  principal: RecordScopePrincipal;
}): CompiledRecordScope => {
  // No config at all is no authorization, which is a deny — never a widening.
  if (rolePermissionConfig === null) {
    return RECORD_SCOPE_DENY_ALL;
  }

  // Bypass short-circuits before a single rule is read, so a corrupt rule can
  // never break a system job.
  if ('shouldBypassPermissionChecks' in rolePermissionConfig) {
    return RECORD_SCOPE_UNRESTRICTED;
  }

  const isUnion = 'unionOf' in rolePermissionConfig;
  const roleIds = isUnion
    ? rolePermissionConfig.unionOf
    : rolePermissionConfig.intersectionOf;

  // No roles is no grant either way, so both arms deny rather than falling to
  // the empty-AND identity of `true`.
  if (roleIds.length === 0) {
    return RECORD_SCOPE_DENY_ALL;
  }

  const scopes = roleIds.map((roleId) =>
    compileForRole({ roleId, rolesPermissions, objectMetadataId, principal }),
  );

  return isUnion ? unionScopes(scopes) : intersectScopes(scopes);
};
