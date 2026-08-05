import { gql } from '@apollo/client';

export const PENDING_PROPOSALS = gql`
  query PendingProposals {
    pendingProposals {
      id
      status
      reason
      expiresAt
      createdAt
      items {
        id
        actionType
        objectNameSingular
        recordId
        payload
        baseline
        status
        error
      }
    }
  }
`;
