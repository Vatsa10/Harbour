import { useMutation } from '@apollo/client/react';
import { isDefined } from 'twenty-shared/utils';

import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { CREATE_IMPORT_BATCH } from '@/object-record/spreadsheet-import/graphql/mutations/createImportBatch';
import { PREPARE_IMPORT_BATCH } from '@/object-record/spreadsheet-import/graphql/mutations/prepareImportBatch';
import { START_IMPORT_BATCH } from '@/object-record/spreadsheet-import/graphql/mutations/startImportBatch';

type RunGuidedImportParams = {
  objectNameSingular: string;
  fileName: string;
  rawRows: Record<string, unknown>[];
  mappedRows: Record<string, unknown>[];
  columnMapping: Record<string, string>;
};

// Drives the create -> prepare -> start sequence added in Tasks 6, 8 and 9
// so the wizard's submit handler stays a single call site instead of
// juggling three mutations and their loading states.
export const useCreateImportBatch = () => {
  const apolloCoreClient = useApolloCoreClient();
  const [createImportBatchMutation] = useMutation<{
    createImportBatch: { id: string };
  }>(CREATE_IMPORT_BATCH, {
    client: apolloCoreClient,
  });
  const [prepareImportBatchMutation] = useMutation(PREPARE_IMPORT_BATCH, {
    client: apolloCoreClient,
  });
  const [startImportBatchMutation] = useMutation(START_IMPORT_BATCH, {
    client: apolloCoreClient,
  });

  const runGuidedImport = async (params: RunGuidedImportParams) => {
    const { data: createData } = await createImportBatchMutation({
      variables: { input: params },
    });
    const importBatchId = createData?.createImportBatch?.id;

    if (!isDefined(importBatchId)) {
      throw new Error('Failed to create import batch.');
    }

    await prepareImportBatchMutation({ variables: { importBatchId } });
    await startImportBatchMutation({ variables: { importBatchId } });

    return importBatchId as string;
  };

  return { runGuidedImport };
};
