import { type AvatarType } from 'searm-ui/data-display';
import { type IconComponent } from 'searm-ui/icon';

export type SelectableItem<T = object> = T & {
  id: string;
  name: string;
  avatarUrl?: string;
  avatarType?: AvatarType;
  AvatarIcon?: IconComponent;
  isSelected: boolean;
  isIconInverted?: boolean;
};
