import { STANDARD_OBJECTS } from 'searm-shared/metadata';
import { isDefined } from 'searm-shared/utils';
import { v4 } from 'uuid';

import { type FlatViewGroup } from 'src/engine/metadata-modules/flat-view-group/types/flat-view-group.type';
import { SEARM_STANDARD_APPLICATION } from 'src/engine/workspace-manager/searm-standard-application/constants/searm-standard-applications';
import { type AllStandardObjectName } from 'src/engine/workspace-manager/searm-standard-application/types/all-standard-object-name.type';
import { type AllStandardObjectViewGroupName } from 'src/engine/workspace-manager/searm-standard-application/types/all-standard-object-view-group-name.type';
import { type AllStandardObjectViewName } from 'src/engine/workspace-manager/searm-standard-application/types/all-standard-object-view-name.type';
import { type StandardBuilderArgs } from 'src/engine/workspace-manager/searm-standard-application/types/metadata-standard-buillder-args.type';

type CreateStandardViewGroupOptions<
  O extends AllStandardObjectName,
  V extends AllStandardObjectViewName<O>,
> = {
  viewName: V;
  viewGroupName: AllStandardObjectViewGroupName<O, V>;
  isVisible: boolean;
  fieldValue: string;
  position: number;
};

export type CreateStandardViewGroupArgs<
  O extends AllStandardObjectName = AllStandardObjectName,
  V extends AllStandardObjectViewName<O> = AllStandardObjectViewName<O>,
> = StandardBuilderArgs<'viewGroup'> & {
  objectName: O;
  context: CreateStandardViewGroupOptions<O, V>;
};

export const createStandardViewGroupFlatMetadata = <
  O extends AllStandardObjectName,
  V extends AllStandardObjectViewName<O>,
>({
  workspaceId,
  objectName,
  context: { viewName, viewGroupName, isVisible, fieldValue, position },
  standardObjectMetadataRelatedEntityIds,
  searmStandardApplicationId,
  now,
}: CreateStandardViewGroupArgs<O, V>): FlatViewGroup => {
  // @ts-expect-error ignore
  const viewDefinition = STANDARD_OBJECTS[objectName].views[viewName] as {
    universalIdentifier: string;
    viewGroups: Record<string, { universalIdentifier: string }>;
  };

  const viewGroupDefinition = viewDefinition.viewGroups[viewGroupName];

  if (!isDefined(viewGroupDefinition)) {
    throw new Error(
      `Invalid configuration ${objectName} ${viewName.toString()} ${viewGroupName}`,
    );
  }

  return {
    id: v4(),
    universalIdentifier: viewGroupDefinition.universalIdentifier,
    applicationId: searmStandardApplicationId,
    applicationUniversalIdentifier:
      SEARM_STANDARD_APPLICATION.universalIdentifier,
    workspaceId,
    viewId:
      standardObjectMetadataRelatedEntityIds[objectName].views[viewName].id,
    viewUniversalIdentifier: viewDefinition.universalIdentifier,
    isVisible,
    fieldValue,
    position,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
};
