import { gql } from '@apollo/client';

export const PENDING_PROPOSALS = gql`
  query PendingProposals {
    pendingProposals {
      id
      status
      expiresAt
      createdAt
      items {
        id
        actionType
        objectNameSingular
        recordId
        toolId
        payload
        baseline
        status
        error
        facts {
          id
          fieldName
          strength
          hasConflict
          sourceType
          sourceLocator
          observedAt
        }
      }
    }
  }
`;
