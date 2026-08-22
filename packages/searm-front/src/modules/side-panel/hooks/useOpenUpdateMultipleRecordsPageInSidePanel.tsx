import { useNavigateSidePanel } from '@/side-panel/hooks/useNavigateSidePanel';
import { SidePanelPages } from 'searm-shared/types';

import { msg, t } from '@lingui/core/macro';
import { useCallback } from 'react';
import { IconBoxMultiple } from 'searm-ui/icon';

type UseOpenUpdateMultipleRecordsPageInSidePanelProps = {
  contextStoreInstanceId: string;
};

export const useOpenUpdateMultipleRecordsPageInSidePanel = ({
  contextStoreInstanceId,
}: UseOpenUpdateMultipleRecordsPageInSidePanelProps) => {
  const { navigateSidePanel } = useNavigateSidePanel();

  const openUpdateMultipleRecordsPageInSidePanel = useCallback(async () => {
    navigateSidePanel({
      page: SidePanelPages.UpdateRecords,
      pageTitle: t(msg`Update records`),
      pageIcon: IconBoxMultiple,
      pageId: contextStoreInstanceId,
    });
  }, [navigateSidePanel, contextStoreInstanceId]);

  return {
    openUpdateMultipleRecordsPageInSidePanel,
  };
};
