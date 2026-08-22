import { useMutation, useQuery } from '@apollo/client/react';

import { MARK_NOTIFICATION_READ } from '@/notifications/graphql/mutations/markNotificationRead';
import { UNREAD_NOTIFICATIONS } from '@/notifications/graphql/queries/unreadNotifications';

export type UnreadNotification = {
  id: string;
  title: string;
  body: string | null;
  linkPath: string | null;
  createdAt: string;
};

type UnreadNotificationsData = {
  unreadNotifications: UnreadNotification[];
};

// The bell is a poll, not a socket. A minute of latency on "a proposal is
// waiting" is acceptable; a websocket for one counter is not the small thing
// this is meant to be.
export const UNREAD_NOTIFICATIONS_POLL_INTERVAL_MS = 60_000;

export const useUnreadNotifications = () => {
  const { data, loading, refetch } = useQuery<UnreadNotificationsData>(
    UNREAD_NOTIFICATIONS,
    { pollInterval: UNREAD_NOTIFICATIONS_POLL_INTERVAL_MS },
  );

  const [markNotificationReadMutation] = useMutation(MARK_NOTIFICATION_READ);

  const notifications = data?.unreadNotifications ?? [];

  const markRead = async (id: string) => {
    await markNotificationReadMutation({ variables: { id } });
    await refetch();
  };

  return {
    notifications,
    unreadCount: notifications.length,
    loading,
    markRead,
    refetch,
  };
};
