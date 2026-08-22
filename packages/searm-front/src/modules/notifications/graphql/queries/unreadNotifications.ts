import { gql } from '@apollo/client';

export const UNREAD_NOTIFICATIONS = gql`
  query UnreadNotifications {
    unreadNotifications {
      id
      title
      body
      linkPath
      createdAt
    }
  }
`;
