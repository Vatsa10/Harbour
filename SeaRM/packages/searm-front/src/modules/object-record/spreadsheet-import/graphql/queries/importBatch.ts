import { gql } from '@apollo/client';

export const IMPORT_BATCH_PREVIEW = gql`
  query ImportBatchPreview($importBatchId: ID!) {
    importBatchPreview(importBatchId: $importBatchId) {
      totalRows
      createCount
      updateCount
      proposeCount
      skipCount
      rowsWithErrorsCount
    }
  }
`;
