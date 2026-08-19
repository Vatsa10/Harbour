// SeaRM — AGPL-3.0. Clean-room test for the row-level-permission predicate
// validator, modeled on the sibling flat-permission-flag-validator spec.

import { Test, type TestingModule } from '@nestjs/testing';

import { createEmptyFlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/constant/create-empty-flat-entity-maps.constant';
import {
  FlatRowLevelPermissionPredicateValidatorService,
  WorkspaceMigrationRowLevelPermissionPredicateExceptionCode,
} from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-row-level-permission-predicate-validator.service';

type FlatRowLevelPermissionPredicateLike = Record<string, unknown> & {
  universalIdentifier: string;
};

// Local test-only stand-in for TestFlatEntityMaps<T>, which constrains T to
// SyncableFlatEntity — more machinery than a plain unit test on the
// validator's own logic needs.
type TestFlatEntityMaps<T> = {
  byUniversalIdentifier: Record<string, T>;
} & Record<string, unknown>;

const ROLE_UID = '00000000-0000-0000-0000-000000000010';
const OBJECT_METADATA_UID = '00000000-0000-0000-0000-000000000020';
const FIELD_METADATA_UID = '00000000-0000-0000-0000-000000000030';
const GROUP_UID = '00000000-0000-0000-0000-000000000040';

const buildFlatPredicate = (
  overrides: Partial<FlatRowLevelPermissionPredicateLike> = {},
): FlatRowLevelPermissionPredicateLike => ({
  id: '00000000-0000-0000-0000-000000000001',
  universalIdentifier: '00000000-0000-0000-0000-000000000001',
  roleUniversalIdentifier: ROLE_UID,
  objectMetadataUniversalIdentifier: OBJECT_METADATA_UID,
  fieldMetadataUniversalIdentifier: FIELD_METADATA_UID,
  operand: 'is',
  value: 'some-value',
  workspaceMemberFieldMetadataUniversalIdentifier: null,
  rowLevelPermissionPredicateGroupUniversalIdentifier: null,
  ...overrides,
});

const buildEmptyMaps = <T>(): TestFlatEntityMaps<T> =>
  createEmptyFlatEntityMaps() as unknown as TestFlatEntityMaps<T>;

const buildMapsWithEntity = <
  T extends { universalIdentifier: string },
>(
  entity: T,
): TestFlatEntityMaps<T> => {
  const maps = buildEmptyMaps<T>();

  maps.byUniversalIdentifier[entity.universalIdentifier] = entity;

  return maps;
};

const buildCreationArgs = (
  flatEntityToValidate: FlatRowLevelPermissionPredicateLike,
  overrides: {
    optimisticFlatRowLevelPermissionPredicateMaps?: TestFlatEntityMaps<FlatRowLevelPermissionPredicateLike>;
    flatRoleMaps?: TestFlatEntityMaps<{ universalIdentifier: string }>;
    flatObjectMetadataMaps?: TestFlatEntityMaps<{ universalIdentifier: string }>;
    flatFieldMetadataMaps?: TestFlatEntityMaps<{ universalIdentifier: string }>;
    flatRowLevelPermissionPredicateGroupMaps?: TestFlatEntityMaps<{
      universalIdentifier: string;
    }>;
  } = {},
) =>
  ({
    flatEntityToValidate,
    optimisticFlatEntityMapsAndRelatedFlatEntityMaps: {
      flatRowLevelPermissionPredicateMaps:
        overrides.optimisticFlatRowLevelPermissionPredicateMaps ??
        buildEmptyMaps(),
      flatRoleMaps:
        overrides.flatRoleMaps ??
        buildMapsWithEntity({ universalIdentifier: ROLE_UID }),
      flatObjectMetadataMaps:
        overrides.flatObjectMetadataMaps ??
        buildMapsWithEntity({ universalIdentifier: OBJECT_METADATA_UID }),
      flatFieldMetadataMaps:
        overrides.flatFieldMetadataMaps ??
        buildMapsWithEntity({ universalIdentifier: FIELD_METADATA_UID }),
      flatRowLevelPermissionPredicateGroupMaps:
        overrides.flatRowLevelPermissionPredicateGroupMaps ??
        buildMapsWithEntity({ universalIdentifier: GROUP_UID }),
    },
    buildOptions: {} as never,
  }) as unknown as Parameters<
    FlatRowLevelPermissionPredicateValidatorService['validateFlatRowLevelPermissionPredicateCreation']
  >[0];

describe('FlatRowLevelPermissionPredicateValidatorService', () => {
  let service: FlatRowLevelPermissionPredicateValidatorService;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [FlatRowLevelPermissionPredicateValidatorService],
    }).compile();

    service = moduleRef.get(FlatRowLevelPermissionPredicateValidatorService);
  });

  describe('validateFlatRowLevelPermissionPredicateCreation', () => {
    it('passes for a valid predicate referencing a field', () => {
      const result = service.validateFlatRowLevelPermissionPredicateCreation(
        buildCreationArgs(buildFlatPredicate()),
      );

      expect(result.errors).toHaveLength(0);
    });

    it('passes for a valid predicate referencing only a group (no field)', () => {
      const result = service.validateFlatRowLevelPermissionPredicateCreation(
        buildCreationArgs(
          buildFlatPredicate({
            fieldMetadataUniversalIdentifier: undefined,
            rowLevelPermissionPredicateGroupUniversalIdentifier: GROUP_UID,
          }),
        ),
      );

      // Field-not-found is expected to be absent since no field is referenced;
      // only the group-reference path is exercised here.
      expect(
        result.errors.some(
          (error) =>
            error.code ===
            WorkspaceMigrationRowLevelPermissionPredicateExceptionCode.INVALID_ROW_LEVEL_PERMISSION_PREDICATE_DATA,
        ),
      ).toBe(false);
    });

    // This is the deny-by-default contract from rlp-recon.md: a predicate
    // resolving to neither a field nor a group is structurally meaningless
    // and MUST be rejected, not silently accepted as an always-true / no-op
    // predicate that would grant unrestricted row access.
    it('DENY-BY-DEFAULT: rejects a predicate referencing neither a field nor a group', () => {
      const result = service.validateFlatRowLevelPermissionPredicateCreation(
        buildCreationArgs(
          buildFlatPredicate({
            fieldMetadataUniversalIdentifier: undefined,
            rowLevelPermissionPredicateGroupUniversalIdentifier: undefined,
          }),
          {
            flatFieldMetadataMaps: buildEmptyMaps(),
          },
        ),
      );

      expect(result.errors).not.toHaveLength(0);
      expect(
        result.errors.some(
          (error) =>
            error.code ===
            WorkspaceMigrationRowLevelPermissionPredicateExceptionCode.INVALID_ROW_LEVEL_PERMISSION_PREDICATE_DATA,
        ),
      ).toBe(true);
    });

    it('rejects a duplicate universal identifier', () => {
      const existing = buildFlatPredicate();

      const result = service.validateFlatRowLevelPermissionPredicateCreation(
        buildCreationArgs(buildFlatPredicate(), {
          optimisticFlatRowLevelPermissionPredicateMaps:
            buildMapsWithEntity(existing),
        }),
      );

      expect(
        result.errors.map((error) => error.code),
      ).toContain(
        WorkspaceMigrationRowLevelPermissionPredicateExceptionCode.ROW_LEVEL_PERMISSION_PREDICATE_ALREADY_EXISTS,
      );
    });

    it('rejects an unresolvable role reference', () => {
      const result = service.validateFlatRowLevelPermissionPredicateCreation(
        buildCreationArgs(buildFlatPredicate(), {
          flatRoleMaps: buildEmptyMaps(),
        }),
      );

      expect(
        result.errors.map((error) => error.code),
      ).toContain(
        WorkspaceMigrationRowLevelPermissionPredicateExceptionCode.INVALID_ROW_LEVEL_PERMISSION_PREDICATE_DATA,
      );
    });
  });

  describe('validateFlatRowLevelPermissionPredicateDeletion', () => {
    it('returns not-found if no existing predicate matches the universalIdentifier', () => {
      const result = service.validateFlatRowLevelPermissionPredicateDeletion({
        flatEntityToValidate: buildFlatPredicate({
          universalIdentifier: '00000000-0000-0000-0000-deadbeefdead',
        }),
        optimisticFlatEntityMapsAndRelatedFlatEntityMaps: {
          flatRowLevelPermissionPredicateMaps: buildEmptyMaps(),
        },
        buildOptions: {} as never,
      } as unknown as Parameters<
        FlatRowLevelPermissionPredicateValidatorService['validateFlatRowLevelPermissionPredicateDeletion']
      >[0]);

      expect(result.errors.map((error) => error.code)).toEqual([
        WorkspaceMigrationRowLevelPermissionPredicateExceptionCode.ROW_LEVEL_PERMISSION_PREDICATE_NOT_FOUND,
      ]);
    });

    it('passes for a valid deletion', () => {
      const existing = buildFlatPredicate();

      const result = service.validateFlatRowLevelPermissionPredicateDeletion({
        flatEntityToValidate: existing,
        optimisticFlatEntityMapsAndRelatedFlatEntityMaps: {
          flatRowLevelPermissionPredicateMaps: buildMapsWithEntity(existing),
        },
        buildOptions: {} as never,
      } as unknown as Parameters<
        FlatRowLevelPermissionPredicateValidatorService['validateFlatRowLevelPermissionPredicateDeletion']
      >[0]);

      expect(result.errors).toHaveLength(0);
    });
  });
});
