import { createAtomState } from '@/ui/utilities/state/jotai/utils/createAtomState';

export const allowRequestsToSearmIconsState = createAtomState<boolean>({
  key: 'allowRequestsToSearmIcons',
  defaultValue: true,
});
