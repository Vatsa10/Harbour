import { type ErrorLike } from '@apollo/client';
import { t } from '@lingui/core/macro';
import { AppPath } from 'searm-shared/types';
import { getAppPath, isDefined } from 'searm-shared/utils';
import { getConflictingRecordFromApolloError } from '~/utils/get-conflicting-record-from-apollo-error.util';
import { type SnackBarOptions } from '@/ui/feedback/snack-bar-manager/states/snackBarInternalComponentState';

export const buildErrorAction = (
  apolloError?: ErrorLike,
): Pick<SnackBarOptions, 'buttonLabel' | 'buttonTo'> | null => {
  if (!apolloError) {
    return null;
  }

  const conflictingRecord = getConflictingRecordFromApolloError(apolloError);

  if (isDefined(conflictingRecord)) {
    return {
      buttonLabel: t`View existing record`,
      buttonTo: getAppPath(AppPath.RecordShowPage, {
        objectNameSingular: conflictingRecord.conflictingObjectNameSingular,
        objectRecordId: conflictingRecord.conflictingRecordId,
      }),
    };
  }

  return null;
};
