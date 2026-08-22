import { gql } from '@apollo/client';

export const CREATE_IMPORT_BATCH = gql`
  mutation CreateImportBatch($input: CreateImportBatchInput!) {
    createImportBatch(input: $input) {
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
