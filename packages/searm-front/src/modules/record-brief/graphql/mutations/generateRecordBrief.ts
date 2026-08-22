import { gql } from '@apollo/client';

export const GENERATE_RECORD_BRIEF = gql`
  mutation GenerateRecordBrief(
    $objectNameSingular: String!
    $recordId: ID!
  ) {
    generateRecordBrief(
      objectNameSingular: $objectNameSingular
      recordId: $recordId
    ) {
      refusalReason
      brief {
        id
        objectNameSingular
        recordId
        narrative
        sections
        factIds
        oldestObservedAt
        refreshedAt
      }
    }
  }
`;
