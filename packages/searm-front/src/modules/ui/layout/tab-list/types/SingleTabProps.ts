import { type IconComponent } from 'searm-ui/icon';

export type SingleTabProps<T extends string = string> = {
  title: string;
  Icon?: IconComponent;
  id: T;
  hide?: boolean;
  disabled?: boolean;
  pill?: string | React.ReactElement;
  logo?: string;
  tooltipContent?: string;
};
