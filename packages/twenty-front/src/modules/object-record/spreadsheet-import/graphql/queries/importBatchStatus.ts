import { gql } from '@apollo/client';

export const IMPORT_BATCH_STATUS = gql`
  query ImportBatch($importBatchId: ID!) {
    importBatch(importBatchId: $importBatchId) {
      id
      status
      totalRows
      processedRows
      createdRowCount
      updatedRowCount
      proposedRowCount
      skippedRowCount
      failedRowCount
    }
  }
`;
