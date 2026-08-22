import { type MockedResponse } from '@apollo/client/testing';
import { MockedProvider } from '@apollo/client/testing/react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';

import { MARK_NOTIFICATION_READ } from '@/notifications/graphql/mutations/markNotificationRead';
import { UNREAD_NOTIFICATIONS } from '@/notifications/graphql/queries/unreadNotifications';
import { useUnreadNotifications } from '@/notifications/hooks/useUnreadNotifications';

const proposalNotification = {
  __typename: 'Notification',
  id: 'notification-1',
  title: 'A proposal is waiting for review',
  body: 'An AI-drafted change needs your approval before it touches any record.',
  linkPath: '/settings/ai/approvals',
  createdAt: '2026-08-17T00:00:00.000Z',
};

const unreadResponse = (
  unreadNotifications: unknown[],
): MockedResponse<Record<string, unknown>> => ({
  request: { query: UNREAD_NOTIFICATIONS },
  result: { data: { unreadNotifications } },
});

const wrapperWith = (mocks: MockedResponse<Record<string, unknown>>[]) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <MockedProvider mocks={mocks}>{children}</MockedProvider>
  );

  return Wrapper;
};

describe('useUnreadNotifications', () => {
  it('should report the unread proposal notification and its link', async () => {
    const { result } = renderHook(() => useUnreadNotifications(), {
      wrapper: wrapperWith([unreadResponse([proposalNotification])]),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.unreadCount).toBe(1);
    expect(result.current.notifications[0].title).toBe(
      'A proposal is waiting for review',
    );
    expect(result.current.notifications[0].linkPath).toBe(
      '/settings/ai/approvals',
    );
  });

  it('should report zero unread when nothing is waiting', async () => {
    const { result } = renderHook(() => useUnreadNotifications(), {
      wrapper: wrapperWith([unreadResponse([])]),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.unreadCount).toBe(0);
  });

  it('should drop the notification from the unread list after marking it read', async () => {
    const markReadMock: MockedResponse<Record<string, unknown>> = {
      request: {
        query: MARK_NOTIFICATION_READ,
        variables: { id: 'notification-1' },
      },
      result: {
        data: {
          markNotificationRead: {
            __typename: 'Notification',
            id: 'notification-1',
            readAt: '2026-08-17T01:00:00.000Z',
          },
        },
      },
    };

    const { result } = renderHook(() => useUnreadNotifications(), {
      wrapper: wrapperWith([
        unreadResponse([proposalNotification]),
        markReadMock,
        // The refetch after the mutation sees an empty inbox.
        unreadResponse([]),
      ]),
    });

    await waitFor(() => expect(result.current.unreadCount).toBe(1));

    await act(async () => {
      await result.current.markRead('notification-1');
    });

    await waitFor(() => expect(result.current.unreadCount).toBe(0));
  });
});
