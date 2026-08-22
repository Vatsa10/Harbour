import { useMutation } from '@apollo/client/react';
import { isDefined } from 'searm-shared/utils';

import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { CREATE_IMPORT_BATCH } from '@/object-record/spreadsheet-import/graphql/mutations/createImportBatch';
import { PREPARE_IMPORT_BATCH } from '@/object-record/spreadsheet-import/graphql/mutations/prepareImportBatch';
import { START_IMPORT_BATCH } from '@/object-record/spreadsheet-import/graphql/mutations/startImportBatch';
import { IMPORT_BATCH_PREVIEW } from '@/object-record/spreadsheet-import/graphql/queries/importBatch';
import { type GuidedImportPreview } from '@/object-record/spreadsheet-import/types/GuidedImportPreview';

type PrepareGuidedImportParams = {
  objectNameSingular: string;
  fileName: string;
  rawRows: Record<string, unknown>[];
  mappedRows: Record<string, unknown>[];
  columnMapping: Record<string, string>;
};

export type PreparedGuidedImport = {
  importBatchId: string;
  preview: GuidedImportPreview;
};

// Deliberately two calls, not one. create -> prepare stages the rows and works
// out what each one would do; start is what actually writes. Chaining all
// three together is what let an EXACT-matched row overwrite a live person or
// company field with no human ever seeing the verdict.
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

  const prepareGuidedImport = async (
    params: PrepareGuidedImportParams,
  ): Promise<PreparedGuidedImport> => {
    const { data: createData } = await createImportBatchMutation({
      variables: { input: params },
    });
    const importBatchId = createData?.createImportBatch?.id;

    if (!isDefined(importBatchId)) {
      throw new Error('Failed to create import batch.');
    }

    await prepareImportBatchMutation({ variables: { importBatchId } });

    const { data: previewData } = await apolloCoreClient.query<{
      importBatchPreview: GuidedImportPreview;
    }>({
      query: IMPORT_BATCH_PREVIEW,
      variables: { importBatchId },
      fetchPolicy: 'network-only',
    });

    const preview = previewData?.importBatchPreview;

    if (!isDefined(preview)) {
      throw new Error('Failed to preview import batch.');
    }

    return { importBatchId, preview };
  };

  const startGuidedImport = async (importBatchId: string): Promise<void> => {
    await startImportBatchMutation({ variables: { importBatchId } });
  };

  return { prepareGuidedImport, startGuidedImport };
};
