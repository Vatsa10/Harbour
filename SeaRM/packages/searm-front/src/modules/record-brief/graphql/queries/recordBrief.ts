import { gql } from '@apollo/client';

// Resolved by the metadata schema (`RecordBriefResolver` is a
// `@MetadataResolver`), so the default Apollo client — which points at
// `/metadata` — is the right one and no explicit client is passed.
export const RECORD_BRIEF = gql`
  query RecordBrief($objectNameSingular: String!, $recordId: ID!) {
    recordBrief(
      objectNameSingular: $objectNameSingular
      recordId: $recordId
    ) {
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
`;
