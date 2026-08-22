import { Trans } from '@lingui/react/macro';
import { IconSettings } from 'searm-ui/icon';
import { MenuItem } from 'searm-ui/navigation';

type DropdownAdvancedSectionMenuItemProps = {
  onClick: () => void;
};

export const DropdownAdvancedSectionMenuItem = ({
  onClick,
}: DropdownAdvancedSectionMenuItemProps) => (
  <MenuItem
    text={<Trans>Advanced</Trans>}
    LeftIcon={IconSettings}
    onClick={onClick}
    hasSubMenu
  />
);
