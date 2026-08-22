import { type AvatarType } from 'searm-ui/data-display';
export type RecordChipData = {
  recordId: string;
  name: string;
  avatarType: AvatarType;
  avatarUrl: string;
  isLabelIdentifier: boolean;
  objectNameSingular: string;
};
