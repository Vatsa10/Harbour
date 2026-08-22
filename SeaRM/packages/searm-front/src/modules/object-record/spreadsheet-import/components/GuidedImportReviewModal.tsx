import { useApolloClient, useLazyQuery } from '@apollo/client/react';
import { useState } from 'react';
import { isDefined } from 'searm-shared/utils';

import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { SpreadsheetImportFailedRowsBanner } from '@/object-record/spreadsheet-import/components/SpreadsheetImportFailedRowsBanner';
import { IMPORT_BATCH_STATUS } from '@/object-record/spreadsheet-import/graphql/queries/importBatchStatus';
import { useCreateImportBatch } from '@/object-record/spreadsheet-import/hooks/useCreateImportBatch';
import { guidedImportReviewState } from '@/object-record/spreadsheet-import/states/guidedImportReviewState';
import { ConfirmationModal } from '@/ui/layout/modal/components/ConfirmationModal';
import { useAtomState } from '@/ui/utilities/state/jotai/hooks/useAtomState';

export const GUIDED_IMPORT_REVIEW_MODAL_ID = 'guided-import-review-modal';

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ATTEMPTS = 400;

type ImportBatchStatusResult = {
  importBatch: {
    id: string;
    status: string;
    totalRows: number;
    processedRows: number;
    failedRowCount: number;
  };
};

// The review step the server always implemented and the client never showed.
// Nothing has been written yet when this renders: the batch is prepared, every
// row already carries its verdict, and `start` only runs on confirm.
export const GuidedImportReviewModal = () => {
  const [review, setReview] = useAtomState(guidedImportReviewState);
  const { startGuidedImport } = useCreateImportBatch();
  const apolloCoreClient = useApolloCoreClient();
  const apolloClient = useApolloClient();
  const [fetchStatus] = useLazyQuery<ImportBatchStatusResult>(
    IMPORT_BATCH_STATUS,
    { client: apolloCoreClient, fetchPolicy: 'network-only' },
  );
  const [isRunning, setIsRunning] = useState(false);
  const [finishedBatchId, setFinishedBatchId] = useState<string | null>(null);

  if (!isDefined(review)) {
    return finishedBatchId === null ? null : (
      <SpreadsheetImportFailedRowsBanner importBatchId={finishedBatchId} />
    );
  }

  const { preview, importBatchId, objectNamePlural } = review;

  // Execution is an enqueued job, so "the mutation resolved" is not "the
  // import finished". Polling is what makes the success message true.
  const waitForCompletion = async () => {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      const { data } = await fetchStatus({ variables: { importBatchId } });
      const status = data?.importBatch?.status;

      if (status === 'COMPLETED' || status === 'FAILED') {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  };

  const handleConfirm = async () => {
    setIsRunning(true);

    try {
      await startGuidedImport(importBatchId);
      await waitForCompletion();
      await apolloClient.refetchQueries({
        updateCache: (cache) => {
          cache.evict({ fieldName: objectNamePlural });
        },
      });
      setFinishedBatchId(importBatchId);
    } finally {
      setIsRunning(false);
      setReview(null);
    }
  };

  const subtitle = [
    `${preview.createCount} record(s) will be created.`,
    `${preview.updateCount} existing record(s) will be updated in place.`,
    `${preview.proposeCount} uncertain match(es) will be raised as proposals for approval instead of written.`,
    `${preview.skipCount} row(s) will be skipped.`,
    `${preview.rowsWithErrorsCount} row(s) failed validation and will not be imported.`,
  ].join(' ');

  return (
    <ConfirmationModal
      modalInstanceId={GUIDED_IMPORT_REVIEW_MODAL_ID}
      title={`Review import of ${preview.totalRows} row(s)`}
      subtitle={subtitle}
      loading={isRunning}
      confirmButtonText="Run import"
      onConfirmClick={handleConfirm}
      onClose={() => setReview(null)}
    />
  );
};
