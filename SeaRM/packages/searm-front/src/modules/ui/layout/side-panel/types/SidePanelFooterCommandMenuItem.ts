import { type IconComponent } from 'searm-ui/icon';

export type SidePanelFooterCommandMenuItem = {
  id: string;
  label: string;
  Icon?: IconComponent;
  isPrimaryCTA?: boolean;
  isPinned?: boolean;
  onClick: () => void;
  disabled?: boolean;
  hotkeys?: string[];
};
