import { RecordTableComponentInstanceContext } from '@/object-record/record-table/states/context/RecordTableComponentInstanceContext';
import { dataLoadingStatusByRealIndexComponentState } from '@/object-record/record-table/virtualization/states/dataLoadingStatusByRealIndexComponentState';
import { createAtomComponentFamilySelector } from '@/ui/utilities/state/jotai/utils/createAtomComponentFamilySelector';
import { type Nullable } from 'searm-shared/types';
import { isDefined } from 'searm-shared/utils';

export const dataLoadingStatusByRealIndexComponentFamilySelector =
  createAtomComponentFamilySelector<
    'loaded' | 'not-loaded' | undefined,
    Nullable<number>
  >({
    key: 'dataLoadingStatusByRealIndexComponentFamilySelector',
    componentInstanceContext: RecordTableComponentInstanceContext,
    get:
      ({ instanceId, familyKey }) =>
      ({ get }) => {
        const realIndex = familyKey;

        const dataLoadingStatusByRealIndex = get(
          dataLoadingStatusByRealIndexComponentState,
          { instanceId },
        );

        if (!isDefined(realIndex)) {
          return undefined;
        }

        const dataLoadingStatus = dataLoadingStatusByRealIndex.get(realIndex);

        return dataLoadingStatus;
      },
  });
