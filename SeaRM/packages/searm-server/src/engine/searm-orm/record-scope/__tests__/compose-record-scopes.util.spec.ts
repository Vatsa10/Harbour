import {
  type ObjectPermissions,
  type RecordScopeNode,
  type RecordScopeRule,
} from 'searm-shared/types';

import { composeRecordScopes } from 'src/engine/searm-orm/record-scope/compose-record-scopes.util';

const ownedByMe: RecordScopeNode = {
  type: 'comparison',
  fieldMetadataId: 'field-owner',
  operator: 'eq',
  value: { source: 'principal', attribute: 'workspaceMemberId' },
};

const emea: RecordScopeNode = {
  type: 'comparison',
  fieldMetadataId: 'field-region',
  operator: 'eq',
  value: { source: 'literal', value: 'EMEA' },
};

const rule = (id: string, expression: RecordScopeNode): RecordScopeRule => ({
  id,
  roleId: 'role-1',
  objectMetadataId: 'object-1',
  expression,
});

const permissionsWith = (
  recordScopeRules: RecordScopeRule[],
): ObjectPermissions => ({
  canReadObjectRecords: true,
  canUpdateObjectRecords: true,
  canSoftDeleteObjectRecords: true,
  canDestroyObjectRecords: true,
  restrictedFields: {},
  recordScopeRules,
  rowLevelPermissionPredicates: [],
  rowLevelPermissionPredicateGroups: [],
});

const me = { workspaceMemberId: 'wm-1' };

describe('composeRecordScopes', () => {
  it('should be unrestricted for a bypass config without reading any rule', () => {
    expect(
      composeRecordScopes({
        rolePermissionConfig: { shouldBypassPermissionChecks: true },
        rolesPermissions: {
          'role-a': { 'object-1': permissionsWith([rule('r1', ownedByMe)]) },
        },
        objectMetadataId: 'object-1',
        principal: {},
      }),
    ).toEqual({ kind: 'unrestricted' });
  });

  it('should be unrestricted for a single role with no rules', () => {
    expect(
      composeRecordScopes({
        rolePermissionConfig: { unionOf: ['role-a'] },
        rolesPermissions: { 'role-a': { 'object-1': permissionsWith([]) } },
        objectMetadataId: 'object-1',
        principal: me,
      }),
    ).toEqual({ kind: 'unrestricted' });
  });

  it('should return the single role scope for a single role with one rule', () => {
    expect(
      composeRecordScopes({
        rolePermissionConfig: { unionOf: ['role-a'] },
        rolesPermissions: {
          'role-a': { 'object-1': permissionsWith([rule('r1', ownedByMe)]) },
        },
        objectMetadataId: 'object-1',
        principal: me,
      }),
    ).toEqual({ kind: 'expression', node: ownedByMe });
  });

  it('should be unrestricted when any union member is unrestricted', () => {
    expect(
      composeRecordScopes({
        rolePermissionConfig: { unionOf: ['role-a', 'role-b'] },
        rolesPermissions: {
          'role-a': { 'object-1': permissionsWith([rule('r1', ownedByMe)]) },
          'role-b': { 'object-1': permissionsWith([]) },
        },
        objectMetadataId: 'object-1',
        principal: me,
      }),
    ).toEqual({ kind: 'unrestricted' });
  });

  it('should OR the scopes of a union of two scoped roles', () => {
    expect(
      composeRecordScopes({
        rolePermissionConfig: { unionOf: ['role-a', 'role-b'] },
        rolesPermissions: {
          'role-a': { 'object-1': permissionsWith([rule('r1', ownedByMe)]) },
          'role-b': { 'object-1': permissionsWith([rule('r2', emea)]) },
        },
        objectMetadataId: 'object-1',
        principal: me,
      }),
    ).toEqual({
      kind: 'expression',
      node: { type: 'group', operator: 'or', children: [ownedByMe, emea] },
    });
  });

  it('should let an unrestricted role contribute nothing to an intersection', () => {
    expect(
      composeRecordScopes({
        rolePermissionConfig: { intersectionOf: ['role-a', 'role-b'] },
        rolesPermissions: {
          'role-a': { 'object-1': permissionsWith([rule('r1', ownedByMe)]) },
          'role-b': { 'object-1': permissionsWith([]) },
        },
        objectMetadataId: 'object-1',
        principal: me,
      }),
    ).toEqual({ kind: 'expression', node: ownedByMe });
  });

  it('should AND scopes from disjoint roles rather than dropping both', () => {
    // Today's compute-permission-intersection.util.ts filters role A's
    // predicates to those whose fieldMetadataId role B also constrains. Owner
    // and region are different fields, so both are dropped and the caller ends
    // up unrestricted — strictly more access than either role alone grants.
    expect(
      composeRecordScopes({
        rolePermissionConfig: { intersectionOf: ['role-a', 'role-b'] },
        rolesPermissions: {
          'role-a': { 'object-1': permissionsWith([rule('r1', ownedByMe)]) },
          'role-b': { 'object-1': permissionsWith([rule('r2', emea)]) },
        },
        objectMetadataId: 'object-1',
        principal: me,
      }),
    ).toEqual({
      kind: 'expression',
      node: { type: 'group', operator: 'and', children: [ownedByMe, emea] },
    });
  });

  it('should deny all when a role in an intersection is missing entirely', () => {
    expect(
      composeRecordScopes({
        rolePermissionConfig: { intersectionOf: ['role-a', 'role-b'] },
        rolesPermissions: {
          'role-a': { 'object-1': permissionsWith([rule('r1', ownedByMe)]) },
        },
        objectMetadataId: 'object-1',
        principal: me,
      }),
    ).toEqual({ kind: 'denyAll' });
  });

  it('should deny all when the only role rule is unresolvable for this principal', () => {
    expect(
      composeRecordScopes({
        rolePermissionConfig: { unionOf: ['role-a'] },
        rolesPermissions: {
          'role-a': { 'object-1': permissionsWith([rule('r1', ownedByMe)]) },
        },
        objectMetadataId: 'object-1',
        principal: {},
      }),
    ).toEqual({ kind: 'denyAll' });
  });

  it('should deny all when an intersection member denies, even beside an unrestricted role', () => {
    expect(
      composeRecordScopes({
        rolePermissionConfig: { intersectionOf: ['role-a', 'role-b'] },
        rolesPermissions: {
          'role-a': { 'object-1': permissionsWith([rule('r1', ownedByMe)]) },
          'role-b': { 'object-1': permissionsWith([]) },
        },
        objectMetadataId: 'object-1',
        principal: {},
      }),
    ).toEqual({ kind: 'denyAll' });
  });

  it('should deny all for an empty union, which grants no role at all', () => {
    expect(
      composeRecordScopes({
        rolePermissionConfig: { unionOf: [] },
        rolesPermissions: {},
        objectMetadataId: 'object-1',
        principal: me,
      }),
    ).toEqual({ kind: 'denyAll' });
  });
});
