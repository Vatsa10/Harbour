import { t } from '@lingui/core/macro';
import { useNavigate } from 'react-router-dom';
import { Pill } from 'searm-ui/data-display';
import { IconBell } from 'searm-ui/icon';

import { useUnreadNotifications } from '@/notifications/hooks/useUnreadNotifications';
import { NavigationDrawerItem } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerItem';

// Renders nothing when nothing is waiting. A permanently-present bell showing
// zero trains people to ignore it; an item that only appears when there is
// something to do is the whole point of the primitive.
export const NotificationBellNavigationItem = () => {
  const navigate = useNavigate();
  const { notifications, unreadCount, markRead } = useUnreadNotifications();

  if (unreadCount === 0) {
    return null;
  }

  const [newest] = notifications;

  const handleClick = async () => {
    // Navigate first: the point of the click is to reach the thing waiting.
    // A failed mark-read leaves the item visible, which is the safe direction.
    if (newest.linkPath !== null) {
      navigate(newest.linkPath);
    }

    await markRead(newest.id);
  };

  return (
    <NavigationDrawerItem
      label={t`Notifications`}
      Icon={IconBell}
      onClick={handleClick}
      rightOptions={<Pill label={String(unreadCount)} />}
      alwaysShowRightOptions
    />
  );
};
