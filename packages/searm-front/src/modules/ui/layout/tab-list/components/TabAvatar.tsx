import { type SingleTabProps } from '@/ui/layout/tab-list/types/SingleTabProps';
import { useContext } from 'react';
import { isDefined } from 'searm-shared/utils';
import { Avatar } from 'searm-ui/data-display';
import { ThemeContext } from 'searm-ui/theme-constants';
import { getAbsoluteImageUrl } from '~/utils/image/getAbsoluteImageUrl';

export const TabAvatar = ({ tab }: { tab: SingleTabProps }) => {
  const { theme } = useContext(ThemeContext);

  if (isDefined(tab.logo)) {
    return (
      <Avatar
        avatarUrl={getAbsoluteImageUrl(tab.logo)}
        size="md"
        placeholder={tab.title}
      />
    );
  }
  return (
    tab.Icon && (
      <tab.Icon
        size={theme.icon.size.md}
        color={
          tab.disabled ? theme.font.color.tertiary : theme.font.color.secondary
        }
        stroke={theme.icon.stroke.md}
      />
    )
  );
};
