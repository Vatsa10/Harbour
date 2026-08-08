import { gql } from '@apollo/client';

export const RETRY_FAILED_IMPORT_ROWS = gql`
  mutation RetryFailedImportRows($importBatchId: ID!) {
    retryFailedImportRows(importBatchId: $importBatchId) {
      id
      status
      totalRows
      createdRowCount
      updatedRowCount
      proposedRowCount
      skippedRowCount
      failedRowCount
    }
  }
`;
