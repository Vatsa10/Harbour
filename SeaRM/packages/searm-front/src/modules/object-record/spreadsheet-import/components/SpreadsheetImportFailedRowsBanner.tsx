import { useLazyQuery, useMutation } from '@apollo/client/react';
import { useEffect } from 'react';

import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { RETRY_FAILED_IMPORT_ROWS } from '@/object-record/spreadsheet-import/graphql/mutations/retryFailedImportRows';
import { IMPORT_BATCH_PREVIEW } from '@/object-record/spreadsheet-import/graphql/queries/importBatch';
import { REACT_APP_SERVER_BASE_URL } from '~/config';

type SpreadsheetImportFailedRowsBannerProps = {
  importBatchId: string;
};

type ImportBatchPreview = {
  rowsWithErrorsCount: number;
};

// Functional-not-styled first pass: this surfaces the failed-rows CSV
// download and the retry mutation added in this task. Linaria styling and
// placement inside the import dialog's result step are follow-up polish,
// not part of this task's data-path scope.
export const SpreadsheetImportFailedRowsBanner = ({
  importBatchId,
}: SpreadsheetImportFailedRowsBannerProps) => {
  const apolloCoreClient = useApolloCoreClient();
  const [fetchPreview, { data }] = useLazyQuery<{
    importBatchPreview: ImportBatchPreview;
  }>(IMPORT_BATCH_PREVIEW, {
    client: apolloCoreClient,
    fetchPolicy: 'network-only',
  });
  const [retryFailedRows] = useMutation(RETRY_FAILED_IMPORT_ROWS, {
    client: apolloCoreClient,
  });

  useEffect(() => {
    fetchPreview({ variables: { importBatchId } });
    // Runs once per batch id - re-running on every render would spam the
    // preview query while the banner stays mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importBatchId]);

  const preview = data?.importBatchPreview;

  if (!preview || preview.rowsWithErrorsCount === 0) {
    return null;
  }

  return (
    <div>
      <span>{preview.rowsWithErrorsCount} row(s) failed to import.</span>
      <a
        href={`${REACT_APP_SERVER_BASE_URL}/rest/import/${importBatchId}/failed-rows.csv`}
      >
        Download failed rows
      </a>
      <button
        onClick={() => retryFailedRows({ variables: { importBatchId } })}
      >
        Retry failed rows
      </button>
    </div>
  );
};
