import { gql } from '@apollo/client';

export const START_IMPORT_BATCH = gql`
  mutation StartImportBatch($importBatchId: ID!) {
    startImportBatch(importBatchId: $importBatchId) {
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
