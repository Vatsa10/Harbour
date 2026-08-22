import { Injectable, Logger } from '@nestjs/common';

import { isDefined, isValidUuid } from 'searm-shared/utils';
import { canObjectBeManagedByAutomation } from 'searm-shared/workflow';

import { CommonUpdateOneQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-update-one-query-runner.service';
import {
  RecordCrudException,
  RecordCrudExceptionCode,
} from 'src/engine/core-modules/record-crud/exceptions/record-crud.exception';
import { CommonApiContextBuilderService } from 'src/engine/core-modules/record-crud/services/common-api-context-builder.service';
import { type UpdateRecordParams } from 'src/engine/core-modules/record-crud/types/update-record-params.type';
import { getRecordDisplayName } from 'src/engine/core-modules/record-crud/utils/get-record-display-name.util';
import { removeUndefinedFromRecord } from 'src/engine/core-modules/record-crud/utils/remove-undefined-from-record.util';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';

@Injectable()
export class UpdateRecordService {
  private readonly logger = new Logger(UpdateRecordService.name);

  constructor(
    private readonly commonUpdateOneRunner: CommonUpdateOneQueryRunnerService,
    private readonly commonApiContextBuilder: CommonApiContextBuilderService,
  ) {}

  async execute(params: UpdateRecordParams): Promise<ToolOutput> {
    const {
      objectName,
      objectRecordId,
      objectRecord,
      fieldsToUpdate,
      authContext,
      rolePermissionConfig,
      updatedBy,
      isHumanApproved,
    } = params;

    if (!isDefined(objectRecordId) || !isValidUuid(objectRecordId)) {
      return {
        success: false,
        message: 'Failed to update: Object record ID must be a valid UUID',
        error: 'Invalid object record ID',
      };
    }

    try {
      const {
        queryRunnerContext,
        selectedFields,
        flatObjectMetadata,
        flatFieldMetadataMaps,
      } = await this.commonApiContextBuilder.build({
        authContext,
        objectName,
        rolePermissionConfig,
      });

      if (
        !isHumanApproved &&
        !canObjectBeManagedByAutomation({
          nameSingular: flatObjectMetadata.nameSingular,
        })
      ) {
        throw new RecordCrudException(
          'Failed to update: Object cannot be updated by automation',
          RecordCrudExceptionCode.INVALID_REQUEST,
        );
      }

      const fieldsToUpdateArray = fieldsToUpdate ?? Object.keys(objectRecord);

      if (fieldsToUpdateArray.length === 0) {
        return {
          success: true,
          message: 'No fields to update',
          result: undefined,
        };
      }

      // Filter objectRecord to only include fieldsToUpdate
      const filteredObjectRecord = Object.keys(objectRecord).reduce(
        (acc, key) => {
          if (fieldsToUpdateArray.includes(key)) {
            return { ...acc, [key]: objectRecord[key] };
          }

          return acc;
        },
        {},
      );

      // Clean undefined values from the record data (including nested composite fields)
      // This prevents validation errors for partial composite field inputs
      const cleanedRecord = removeUndefinedFromRecord(filteredObjectRecord);

      // An explicit actor (IMPORT, WORKFLOW, AGENT) must survive to the stored
      // record, or the audit trail cannot tell an import-driven update from a
      // hand edit. The actor hook keeps the source and re-derives the identity
      // from the auth context, so this cannot be used to spoof an actor.
      const dataWithActor = isDefined(updatedBy)
        ? { ...cleanedRecord, updatedBy }
        : cleanedRecord;

      const { results: updatedRecord } =
        await this.commonUpdateOneRunner.execute(
          {
            id: objectRecordId,
            data: dataWithActor,
            selectedFields,
          },
          queryRunnerContext,
        );

      this.logger.log(`Record updated successfully in ${objectName}`);

      return {
        success: true,
        message: `Record updated successfully in ${objectName}`,
        result: params.slimResponse ? { id: objectRecordId } : updatedRecord,
        recordReferences: [
          {
            objectNameSingular: objectName,
            recordId: objectRecordId,
            displayName: getRecordDisplayName(
              updatedRecord,
              flatObjectMetadata,
              flatFieldMetadataMaps,
            ),
          },
        ],
      };
    } catch (error) {
      if (error instanceof RecordCrudException) {
        return {
          success: false,
          message: `Failed to update record in ${objectName}`,
          error: error.message,
        };
      }

      this.logger.error(`Failed to update record: ${error}`);

      return {
        success: false,
        message: `Failed to update record in ${objectName}`,
        error:
          error instanceof Error ? error.message : 'Failed to update record',
      };
    }
  }
}
