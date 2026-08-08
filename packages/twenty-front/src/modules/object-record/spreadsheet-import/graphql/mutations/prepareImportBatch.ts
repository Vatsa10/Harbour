import { gql } from '@apollo/client';

export const PREPARE_IMPORT_BATCH = gql`
  mutation PrepareImportBatch($importBatchId: ID!) {
    prepareImportBatch(importBatchId: $importBatchId) {
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
