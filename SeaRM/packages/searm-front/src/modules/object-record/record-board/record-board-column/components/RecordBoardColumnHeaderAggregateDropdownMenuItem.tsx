import { type IconComponent } from 'searm-ui/icon';
import { MenuItem } from 'searm-ui/navigation';

export const RecordBoardColumnHeaderAggregateDropdownMenuItem = ({
  onContentChange,
  text,
  hasSubMenu,
  RightIcon,
}: {
  onContentChange: () => void;
  hasSubMenu: boolean;
  text: string;
  RightIcon?: IconComponent | null;
}) => {
  return (
    <MenuItem
      onClick={onContentChange}
      text={text}
      hasSubMenu={hasSubMenu}
      RightIcon={RightIcon}
    />
  );
};
