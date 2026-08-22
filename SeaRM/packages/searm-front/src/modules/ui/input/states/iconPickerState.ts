import { createAtomState } from '@/ui/utilities/state/jotai/utils/createAtomState';
import { IconApps, type IconComponent } from 'searm-ui/icon';

type IconPickerState = {
  Icon: IconComponent;
  iconKey: string;
};

export const iconPickerState = createAtomState<IconPickerState>({
  key: 'iconPickerState',
  defaultValue: { Icon: IconApps, iconKey: 'IconApps' },
});
