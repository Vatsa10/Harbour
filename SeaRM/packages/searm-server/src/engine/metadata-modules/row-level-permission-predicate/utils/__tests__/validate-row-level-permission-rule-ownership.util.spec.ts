// SeaRM — AGPL-3.0. Clean-room, from-scratch spec for the from-scratch
// ownership util in this rewrite (see design rationale in the util file).

import { RowLevelPermissionPredicateGroupLogicalOperator } from 'searm-shared/types';

import { validateRowLevelPermissionRuleOwnershipOrThrow } from 'src/engine/metadata-modules/row-level-permission-predicate/utils/validate-row-level-permission-rule-ownership.util';

const ROLE_ID = 'role-1';
const OTHER_ROLE_ID = 'role-2';
const OBJECT_METADATA_ID = 'object-1';
const OTHER_OBJECT_METADATA_ID = 'object-2';

const existingPredicate = {
  id: 'predicate-owned',
  universalIdentifier: 'predicate-owned',
  roleId: ROLE_ID,
  objectMetadataId: OBJECT_METADATA_ID,
};

const foreignPredicate = {
  id: 'predicate-foreign',
  universalIdentifier: 'predicate-foreign',
  roleId: OTHER_ROLE_ID,
  objectMetadataId: OTHER_OBJECT_METADATA_ID,
};

const existingGroup = {
  id: 'group-owned',
  universalIdentifier: 'group-owned',
  roleId: ROLE_ID,
  objectMetadataId: OBJECT_METADATA_ID,
};

const foreignGroup = {
  id: 'group-foreign',
  universalIdentifier: 'group-foreign',
  roleId: OTHER_ROLE_ID,
  objectMetadataId: OTHER_OBJECT_METADATA_ID,
};

const buildPredicateMaps = () => ({
  universalIdentifierById: {
    [existingPredicate.id]: existingPredicate.universalIdentifier,
    [foreignPredicate.id]: foreignPredicate.universalIdentifier,
  },
  byUniversalIdentifier: {
    [existingPredicate.universalIdentifier]: existingPredicate,
    [foreignPredicate.universalIdentifier]: foreignPredicate,
  },
});

const buildGroupMaps = () => ({
  universalIdentifierById: {
    [existingGroup.id]: existingGroup.universalIdentifier,
    [foreignGroup.id]: foreignGroup.universalIdentifier,
  },
  byUniversalIdentifier: {
    [existingGroup.universalIdentifier]: existingGroup,
    [foreignGroup.universalIdentifier]: foreignGroup,
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asMaps = (value: unknown) => value as any;

describe('validateRowLevelPermissionRuleOwnershipOrThrow', () => {
  it('allows predicates and groups with no id (creations)', () => {
    expect(() =>
      validateRowLevelPermissionRuleOwnershipOrThrow({
        roleId: ROLE_ID,
        objectMetadataId: OBJECT_METADATA_ID,
        predicates: [
          {
            fieldMetadataId: 'field-1',
            operand: 'IS' as never,
          },
        ],
        predicateGroups: [
          {
            objectMetadataId: OBJECT_METADATA_ID,
            logicalOperator: RowLevelPermissionPredicateGroupLogicalOperator.AND,
          },
        ],
        existingFlatRowLevelPermissionPredicateMaps: asMaps(
          buildPredicateMaps(),
        ),
        existingFlatRowLevelPermissionPredicateGroupMaps: asMaps(
          buildGroupMaps(),
        ),
      }),
    ).not.toThrow();
  });

  it('allows updating a predicate owned by the same role and object', () => {
    expect(() =>
      validateRowLevelPermissionRuleOwnershipOrThrow({
        roleId: ROLE_ID,
        objectMetadataId: OBJECT_METADATA_ID,
        predicates: [
          {
            id: existingPredicate.id,
            fieldMetadataId: 'field-1',
            operand: 'IS' as never,
          },
        ],
        predicateGroups: [],
        existingFlatRowLevelPermissionPredicateMaps: asMaps(
          buildPredicateMaps(),
        ),
        existingFlatRowLevelPermissionPredicateGroupMaps: asMaps(
          buildGroupMaps(),
        ),
      }),
    ).not.toThrow();
  });

  it('denies updating a predicate owned by a different role/object (cross-tenant hijack)', () => {
    expect(() =>
      validateRowLevelPermissionRuleOwnershipOrThrow({
        roleId: ROLE_ID,
        objectMetadataId: OBJECT_METADATA_ID,
        predicates: [
          {
            id: foreignPredicate.id,
            fieldMetadataId: 'field-1',
            operand: 'IS' as never,
          },
        ],
        predicateGroups: [],
        existingFlatRowLevelPermissionPredicateMaps: asMaps(
          buildPredicateMaps(),
        ),
        existingFlatRowLevelPermissionPredicateGroupMaps: asMaps(
          buildGroupMaps(),
        ),
      }),
    ).toThrow();
  });

  it('denies a predicate id that does not exist at all', () => {
    expect(() =>
      validateRowLevelPermissionRuleOwnershipOrThrow({
        roleId: ROLE_ID,
        objectMetadataId: OBJECT_METADATA_ID,
        predicates: [
          {
            id: 'does-not-exist',
            fieldMetadataId: 'field-1',
            operand: 'IS' as never,
          },
        ],
        predicateGroups: [],
        existingFlatRowLevelPermissionPredicateMaps: asMaps(
          buildPredicateMaps(),
        ),
        existingFlatRowLevelPermissionPredicateGroupMaps: asMaps(
          buildGroupMaps(),
        ),
      }),
    ).toThrow();
  });

  it('allows updating a group owned by the same role and object', () => {
    expect(() =>
      validateRowLevelPermissionRuleOwnershipOrThrow({
        roleId: ROLE_ID,
        objectMetadataId: OBJECT_METADATA_ID,
        predicates: [],
        predicateGroups: [
          {
            id: existingGroup.id,
            objectMetadataId: OBJECT_METADATA_ID,
            logicalOperator: RowLevelPermissionPredicateGroupLogicalOperator.AND,
          },
        ],
        existingFlatRowLevelPermissionPredicateMaps: asMaps(
          buildPredicateMaps(),
        ),
        existingFlatRowLevelPermissionPredicateGroupMaps: asMaps(
          buildGroupMaps(),
        ),
      }),
    ).not.toThrow();
  });

  it('denies updating a group owned by a different role/object', () => {
    expect(() =>
      validateRowLevelPermissionRuleOwnershipOrThrow({
        roleId: ROLE_ID,
        objectMetadataId: OBJECT_METADATA_ID,
        predicates: [],
        predicateGroups: [
          {
            id: foreignGroup.id,
            objectMetadataId: OBJECT_METADATA_ID,
            logicalOperator: RowLevelPermissionPredicateGroupLogicalOperator.AND,
          },
        ],
        existingFlatRowLevelPermissionPredicateMaps: asMaps(
          buildPredicateMaps(),
        ),
        existingFlatRowLevelPermissionPredicateGroupMaps: asMaps(
          buildGroupMaps(),
        ),
      }),
    ).toThrow();
  });

  it('denies a predicate referencing a foreign predicateGroupId not in this upsert', () => {
    expect(() =>
      validateRowLevelPermissionRuleOwnershipOrThrow({
        roleId: ROLE_ID,
        objectMetadataId: OBJECT_METADATA_ID,
        predicates: [
          {
            fieldMetadataId: 'field-1',
            operand: 'IS' as never,
            rowLevelPermissionPredicateGroupId: foreignGroup.id,
          },
        ],
        predicateGroups: [],
        existingFlatRowLevelPermissionPredicateMaps: asMaps(
          buildPredicateMaps(),
        ),
        existingFlatRowLevelPermissionPredicateGroupMaps: asMaps(
          buildGroupMaps(),
        ),
      }),
    ).toThrow();
  });

  it('allows a predicate referencing a group being created in the same upsert', () => {
    expect(() =>
      validateRowLevelPermissionRuleOwnershipOrThrow({
        roleId: ROLE_ID,
        objectMetadataId: OBJECT_METADATA_ID,
        predicates: [
          {
            fieldMetadataId: 'field-1',
            operand: 'IS' as never,
            rowLevelPermissionPredicateGroupId: 'new-group-id',
          },
        ],
        predicateGroups: [
          {
            id: 'new-group-id',
            objectMetadataId: OBJECT_METADATA_ID,
            logicalOperator: RowLevelPermissionPredicateGroupLogicalOperator.AND,
          },
        ],
        existingFlatRowLevelPermissionPredicateMaps: asMaps(
          buildPredicateMaps(),
        ),
        existingFlatRowLevelPermissionPredicateGroupMaps: asMaps(
          buildGroupMaps(),
        ),
      }),
    ).not.toThrow();
  });

  it('denies a group referencing a foreign parent group not in this upsert', () => {
    expect(() =>
      validateRowLevelPermissionRuleOwnershipOrThrow({
        roleId: ROLE_ID,
        objectMetadataId: OBJECT_METADATA_ID,
        predicates: [],
        predicateGroups: [
          {
            id: 'new-group-id',
            objectMetadataId: OBJECT_METADATA_ID,
            logicalOperator: RowLevelPermissionPredicateGroupLogicalOperator.AND,
            parentRowLevelPermissionPredicateGroupId: foreignGroup.id,
          },
        ],
        existingFlatRowLevelPermissionPredicateMaps: asMaps(
          buildPredicateMaps(),
        ),
        existingFlatRowLevelPermissionPredicateGroupMaps: asMaps(
          buildGroupMaps(),
        ),
      }),
    ).toThrow();
  });
});
