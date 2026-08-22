import { STANDARD_OBJECTS } from 'searm-shared/metadata';
import { ObjectOpenRecordIn } from 'searm-shared/types';
import { SEARM_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER } from 'searm-shared/application';

import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type AllStandardObjectFieldName } from 'src/engine/workspace-manager/searm-standard-application/types/all-standard-object-field-name.type';
import { type AllStandardObjectName } from 'src/engine/workspace-manager/searm-standard-application/types/all-standard-object-name.type';
import { type StandardBuilderArgs } from 'src/engine/workspace-manager/searm-standard-application/types/metadata-standard-buillder-args.type';

export type CreateStandardObjectContext<O extends AllStandardObjectName> = {
  universalIdentifier: string;
  nameSingular: O;
  namePlural: string;
  labelSingular: string;
  labelPlural: string;
  description: string;
  icon: string;
  isSystem?: boolean;
  isSearchable?: boolean;
  isAuditLogged?: boolean;
  isUIEditable?: boolean;
  isUICreatable?: boolean;
  openRecordIn?: ObjectOpenRecordIn;
  shortcut?: string | null;
  duplicateCriteria?: string[][] | null;
  labelIdentifierFieldMetadataName: AllStandardObjectFieldName<O>;
  imageIdentifierFieldMetadataName?: AllStandardObjectFieldName<O>;
};

export type CreateStandardObjectArgs<
  O extends AllStandardObjectName = AllStandardObjectName,
> = StandardBuilderArgs<'objectMetadata'> & {
  objectName: O;
  context: CreateStandardObjectContext<O>;
};

export const createStandardObjectFlatMetadata = <
  O extends AllStandardObjectName,
>({
  context: {
    universalIdentifier,
    nameSingular,
    namePlural,
    labelSingular,
    labelPlural,
    description,
    icon,
    isSystem = false,
    isSearchable = false,
    isAuditLogged = true,
    isUIEditable = true,
    isUICreatable = true,
    openRecordIn = ObjectOpenRecordIn.USER_CHOICE,
    shortcut = null,
    duplicateCriteria = null,
    labelIdentifierFieldMetadataName,
    imageIdentifierFieldMetadataName,
  },
  workspaceId,
  standardObjectMetadataRelatedEntityIds,
  searmStandardApplicationId,
  now,
}: CreateStandardObjectArgs<O>): FlatObjectMetadata => {
  const labelIdentifierFieldMetadataUniversalIdentifier =
    // @ts-expect-error ignore
    STANDARD_OBJECTS[nameSingular as keyof typeof STANDARD_OBJECTS].fields[
      labelIdentifierFieldMetadataName
    ].universalIdentifier;

  const imageIdentifierFieldMetadataUniversalIdentifier =
    imageIdentifierFieldMetadataName
      ? // @ts-expect-error ignore
        STANDARD_OBJECTS[nameSingular as keyof typeof STANDARD_OBJECTS].fields[
          imageIdentifierFieldMetadataName
        ].universalIdentifier
      : null;

  return {
    universalIdentifier,
    applicationId: searmStandardApplicationId,
    workspaceId,
    nameSingular,
    namePlural,
    labelSingular,
    labelPlural,
    color: null,
    description,
    icon,
    isRemote: false,
    isActive: true,
    isSystem,
    isSearchable,
    isAuditLogged,
    isUIEditable,
    isUICreatable,
    openRecordIn,
    isLabelSyncedWithName: false,
    overrides: null,
    duplicateCriteria,
    shortcut,
    labelIdentifierFieldMetadataId:
      standardObjectMetadataRelatedEntityIds[nameSingular].fields[
        labelIdentifierFieldMetadataName
      ].id,
    imageIdentifierFieldMetadataId: imageIdentifierFieldMetadataName
      ? standardObjectMetadataRelatedEntityIds[nameSingular].fields[
          imageIdentifierFieldMetadataName
        ].id
      : null,
    targetTableName: 'DEPRECATED',
    fieldIds: [],
    indexMetadataIds: [],
    searchFieldMetadataIds: [],
    objectPermissionIds: [],
    fieldPermissionIds: [],
    viewIds: [],
    createdAt: now,
    updatedAt: now,
    id: standardObjectMetadataRelatedEntityIds[nameSingular].id,
    applicationUniversalIdentifier:
      SEARM_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER,
    fieldUniversalIdentifiers: [],
    objectPermissionUniversalIdentifiers: [],
    fieldPermissionUniversalIdentifiers: [],
    viewUniversalIdentifiers: [],
    indexMetadataUniversalIdentifiers: [],
    searchFieldMetadataUniversalIdentifiers: [],
    labelIdentifierFieldMetadataUniversalIdentifier,
    imageIdentifierFieldMetadataUniversalIdentifier,
  };
};
