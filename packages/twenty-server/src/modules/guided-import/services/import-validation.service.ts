import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { Repository } from 'typeorm';

import { getFlatFieldsFromFlatObjectMetadata } from 'src/engine/api/graphql/workspace-schema-builder/utils/get-flat-fields-for-flat-object-metadata.util';
import { generateRecordPropertiesZodSchema } from 'src/engine/core-modules/record-crud/zod-schemas/record-properties.zod-schema';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import { ImportRowMatchAction } from 'src/modules/guided-import/types/import-batch-status.type';

@Injectable()
export class ImportValidationService {
  constructor(
    private readonly flatEntityMapsCacheService: WorkspaceManyOrAllFlatEntityMapsCacheService,
    // Staging tables are core-schema platform infrastructure, not
    // workspace-object data, so the scoped repository wrapper doesn't apply.
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(ImportBatchEntity)
    private readonly importBatchRepository: Repository<ImportBatchEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(ImportRowEntity)
    private readonly importRowRepository: Repository<ImportRowEntity>,
  ) {}

  async validateBatch(importBatchId: string): Promise<void> {
    const batch = await this.importBatchRepository.findOne({
      where: { id: importBatchId },
    });

    if (!isDefined(batch)) {
      return;
    }

    const { flatObjectMetadataMaps, flatFieldMetadataMaps } =
      await this.flatEntityMapsCacheService.getOrRecomputeManyOrAllFlatEntityMaps(
        {
          workspaceId: batch.workspaceId,
          flatMapsKeys: ['flatObjectMetadataMaps', 'flatFieldMetadataMaps'],
        },
      );

    const flatObject = Object.values(
      flatObjectMetadataMaps.byUniversalIdentifier,
    ).find(
      (candidate) => candidate?.nameSingular === batch.objectNameSingular,
    );

    if (!isDefined(flatObject)) {
      return;
    }

    const fields = getFlatFieldsFromFlatObjectMetadata(
      flatObject,
      flatFieldMetadataMaps,
    );
    const objectMetadata = { ...flatObject, fields };
    // .partial() so UPDATE/PROPOSE rows (which only carry changed fields)
    // aren't penalized for omitting fields they are not touching. CREATE
    // rows' required-ness is enforced separately below, by design - reusing
    // this schema's own required/optional split would need
    // generateCreateRecordInputSchema, which additionally demands an `id`-less
    // shape per action type; checking isNullable directly here is simpler and
    // exercises the exact same field list.
    const schema = generateRecordPropertiesZodSchema(
      objectMetadata as never,
    ).partial();

    const rows = await this.importRowRepository.find({
      where: { importBatchId },
    });

    for (const row of rows) {
      if (row.matchAction === ImportRowMatchAction.SKIP) {
        continue;
      }

      const mappedData = row.mappedData ?? {};
      const parseResult = schema.safeParse(mappedData);
      const validationErrors: Record<string, string> = {};

      if (!parseResult.success) {
        for (const issue of parseResult.error.issues) {
          const fieldName = String(issue.path[0] ?? 'unknown');

          validationErrors[fieldName] = issue.message;
        }
      }

      if (row.matchAction === ImportRowMatchAction.CREATE) {
        for (const field of fields) {
          // Non-nullable alone is not "the user must supply it": createdAt,
          // position, searchVector and every other system column are
          // non-nullable and filled by the platform. Only a field with no
          // default and no system ownership is genuinely the importer's to
          // provide — without this, every CREATE row failed validation.
          if (
            !field.isNullable &&
            !field.isSystem &&
            !isDefined(field.defaultValue) &&
            field.name !== 'id' &&
            !isDefined(mappedData[field.name]) &&
            !isDefined(validationErrors[field.name])
          ) {
            validationErrors[field.name] = `${field.label} is required.`;
          }
        }
      }

      await this.importRowRepository.save({ ...row, validationErrors });
    }
  }
}
