import { StandalonePageCommandMenu } from '@/command-menu-item/components/StandalonePageCommandMenu';
import { isLayoutCustomizationModeEnabledState } from '@/layout-customization/states/isLayoutCustomizationModeEnabledState';
import { navigationMenuItemsSelector } from '@/navigation-menu-item/common/states/navigationMenuItemsSelector';
import { SidePanelToggleButton } from '@/side-panel/components/SidePanelToggleButton';
import { PageCardHeader } from '@/ui/layout/page/components/PageCardHeader';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useContext } from 'react';
import { isDefined } from 'searm-shared/utils';
import { useIcons } from 'searm-ui/icon';
import { ThemeContext } from 'searm-ui/theme-constants';

type StandalonePageHeaderProps = {
  pageLayoutId: string;
};

export const StandalonePageHeader = ({
  pageLayoutId,
}: StandalonePageHeaderProps) => {
  const { getIcon } = useIcons();
  const { theme } = useContext(ThemeContext);
  const navigationMenuItems = useAtomStateValue(navigationMenuItemsSelector);
  const isLayoutCustomizationModeEnabled = useAtomStateValue(
    isLayoutCustomizationModeEnabledState,
  );

  const navigationMenuItem = navigationMenuItems.find(
    (item) => item.pageLayoutId === pageLayoutId,
  );

  const title = navigationMenuItem?.name ?? '';
  const Icon = isDefined(navigationMenuItem?.icon)
    ? getIcon(navigationMenuItem.icon)
    : undefined;

  return (
    <PageCardHeader
      icon={isDefined(Icon) ? <Icon size={theme.icon.size.md} /> : undefined}
      title={title}
      actionButton={
        <>
          <StandalonePageCommandMenu />
          {!isLayoutCustomizationModeEnabled && <SidePanelToggleButton />}
        </>
      }
    />
  );
};
