import { ViewType, ViewKey } from 'searm-shared/types';

import { type FlatView } from 'src/engine/metadata-modules/flat-view/types/flat-view.type';

import {
  createStandardViewFlatMetadata,
  type CreateStandardViewArgs,
} from 'src/engine/workspace-manager/searm-standard-application/utils/view/create-standard-view-flat-metadata.util';

export const computeStandardTimelineActivityViews = (
  args: Omit<CreateStandardViewArgs<'timelineActivity'>, 'context'>,
): Record<string, FlatView> => {
  return {
    allTimelineActivities: createStandardViewFlatMetadata({
      ...args,
      objectName: 'timelineActivity',
      context: {
        viewName: 'allTimelineActivities',
        name: 'All {objectLabelPlural}',
        type: ViewType.TABLE,
        key: ViewKey.INDEX,
        position: 0,
        icon: 'IconList',
      },
    }),
  };
};
