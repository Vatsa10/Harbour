import { Injectable } from '@nestjs/common';

import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { MetadataFlatEntity } from 'src/engine/metadata-modules/flat-entity/types/metadata-flat-entity.type';
import { getMetadataFlatEntityMapsKey } from 'src/engine/metadata-modules/flat-entity/utils/get-metadata-flat-entity-maps-key.util';
import { getSubFlatEntityMapsByApplicationIdsOrThrow } from 'src/engine/metadata-modules/flat-entity/utils/get-sub-flat-entity-maps-by-application-ids-or-throw.util';
import { GlobalWorkspaceOrmManager } from 'src/engine/searm-orm/global-workspace-datasource/global-workspace-orm.manager';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { SEARM_STANDARD_ALL_METADATA_NAME } from 'src/engine/workspace-manager/searm-standard-application/constants/searm-standard-all-metadata-name.constant';
import { computeSearmStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/searm-standard-application/utils/searm-standard-application-all-flat-entity-maps.constant';
import { WorkspaceMigrationBuilderException } from 'src/engine/workspace-manager/workspace-migration/exceptions/workspace-migration-builder-exception';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';
import { FromToAllUniversalFlatEntityMaps } from 'src/engine/workspace-manager/workspace-migration/types/workspace-migration-orchestrator.type';

// TODO completely deprecate this file once we've created the searm-standard searm-app manifest
@Injectable()
export class SearmStandardApplicationService {
  constructor(
    private readonly applicationService: ApplicationService,
    private readonly workspaceMigrationValidateBuildAndRunService: WorkspaceMigrationValidateBuildAndRunService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async synchronizeSearmStandardApplicationOrThrow({
    workspaceId,
  }: {
    workspaceId: string;
  }) {
    const { searmStandardFlatApplication } =
      await this.applicationService.findWorkspaceSearmStandardAndCustomApplicationOrThrow(
        {
          workspaceId,
        },
      );
    const { featureFlagsMap, ...fromSearmStandardAllFlatEntityMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        ...SEARM_STANDARD_ALL_METADATA_NAME.map(getMetadataFlatEntityMapsKey),
        'featureFlagsMap',
      ]);

    const {
      allFlatEntityMaps: toSearmStandardAllFlatEntityMaps,
      idByUniversalIdentifierByMetadataName,
    } = computeSearmStandardApplicationAllFlatEntityMaps({
      now: new Date().toISOString(),
      workspaceId,
      searmStandardApplicationId: searmStandardFlatApplication.id,
    });

    const fromToAllFlatEntityMaps: FromToAllUniversalFlatEntityMaps = {};

    for (const metadataName of SEARM_STANDARD_ALL_METADATA_NAME) {
      const flatEntityMapsKey = getMetadataFlatEntityMapsKey(metadataName);
      const fromFlatEntityMaps =
        fromSearmStandardAllFlatEntityMaps[flatEntityMapsKey];
      const fromTo = {
        from: getSubFlatEntityMapsByApplicationIdsOrThrow<
          MetadataFlatEntity<typeof metadataName>
        >({
          applicationIds: [searmStandardFlatApplication.id],
          flatEntityMaps: fromFlatEntityMaps,
        }),
        to: toSearmStandardAllFlatEntityMaps[flatEntityMapsKey],
      };

      // @ts-expect-error Metadata flat entity maps cache key and metadataName colliding
      fromToAllFlatEntityMaps[flatEntityMapsKey] = fromTo;
    }

    const validateAndBuildResult =
      await this.workspaceMigrationValidateBuildAndRunService.validateBuildAndRunWorkspaceMigrationFromTo(
        {
          buildOptions: {
            isSystemBuild: true,
            inferDeletionFromMissingEntities: true,
            applicationUniversalIdentifier:
              searmStandardFlatApplication.universalIdentifier,
          },
          fromToAllFlatEntityMaps,
          workspaceId,
          additionalCacheDataMaps: {
            featureFlagsMap,
          },
          idByUniversalIdentifierByMetadataName,
        },
      );

    if (validateAndBuildResult.status === 'fail') {
      throw new WorkspaceMigrationBuilderException(
        validateAndBuildResult,
        'Multiple validation errors occurred while synchronizing searm-standard application',
      );
    }
  }
}
