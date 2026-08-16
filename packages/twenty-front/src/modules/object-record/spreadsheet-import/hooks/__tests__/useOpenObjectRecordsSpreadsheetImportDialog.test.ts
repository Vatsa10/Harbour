import { renderHook } from '@testing-library/react';
import { act } from 'react';
import gql from 'graphql-tag';

import { CoreObjectNameSingular } from 'twenty-shared/types';
import { guidedImportReviewState } from '@/object-record/spreadsheet-import/states/guidedImportReviewState';
import { spreadsheetImportDialogState } from '@/spreadsheet-import/states/spreadsheetImportDialogState';
import { useOpenObjectRecordsSpreadsheetImportDialog } from '@/object-record/spreadsheet-import/hooks/useOpenObjectRecordsSpreadsheetImportDialog';
import { jotaiStore } from '@/ui/utilities/state/jotai/jotaiStore';
import { getJestMetadataAndApolloMocksWrapper } from '~/testing/jest/getJestMetadataAndApolloMocksWrapper';

const COMPANY_ID = 'cb2e9f4b-20c3-4759-9315-4ffeecfaf71a';

jest.mock('uuid', () => ({
  ...jest.requireActual('uuid'),
  v4: jest.fn(() => 'cb2e9f4b-20c3-4759-9315-4ffeecfaf71a'),
}));

const mockBatchCreateManyRecords = jest.fn().mockResolvedValue([]);

jest.mock('@/object-record/hooks/useBatchCreateManyRecords', () => ({
  useBatchCreateManyRecords: () => ({
    batchCreateManyRecords: mockBatchCreateManyRecords,
  }),
}));

const mockPreview = {
  totalRows: 1,
  createCount: 0,
  updateCount: 1,
  proposeCount: 0,
  skipCount: 0,
  rowsWithErrorsCount: 0,
};

const mockPrepareGuidedImport = jest.fn().mockResolvedValue({
  importBatchId: 'import-batch-id',
  preview: mockPreview,
});
const mockStartGuidedImport = jest.fn().mockResolvedValue(undefined);

jest.mock('@/object-record/spreadsheet-import/hooks/useCreateImportBatch', () => ({
  useCreateImportBatch: () => ({
    prepareGuidedImport: mockPrepareGuidedImport,
    startGuidedImport: mockStartGuidedImport,
  }),
}));

const mockResult = jest.fn(() => ({
  data: {
    createCompanies: [
      {
        id: COMPANY_ID,
        name: 'Example Company',
        employees: 0,
        idealCustomerProfile: true,
        __typename: 'Company',
      },
    ],
  },
}));

const companyMocks = [
  {
    request: {
      query: gql`
        mutation CreateCompanies(
          $data: [CompanyCreateInput!]!
          $upsert: Boolean
        ) {
          createCompanies(data: $data, upsert: $upsert) {
            id
            name
            employees
            idealCustomerProfile
            __typename
          }
        }
      `,
    },
    variableMatcher: () => true,
    result: mockResult,
  },
];

const fakeCsv = () => {
  const csvContent = 'name\nExample Company';
  const blob = new Blob([csvContent], { type: 'text/csv' });
  return new File([blob], 'fakeData.csv', { type: 'text/csv' });
};

const Wrapper = getJestMetadataAndApolloMocksWrapper({
  apolloMocks: companyMocks,
});

describe('useOpenObjectRecordsSpreadsheetImportDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should open dialog and configure onSubmit function correctly', async () => {
    const { result } = renderHook(
      () => {
        const { openObjectRecordsSpreadsheetImportDialog } =
          useOpenObjectRecordsSpreadsheetImportDialog(
            CoreObjectNameSingular.Company,
          );
        return {
          openObjectRecordsSpreadsheetImportDialog,
        };
      },
      { wrapper: Wrapper },
    );

    const spreadsheetImportDialog = jotaiStore.get(
      spreadsheetImportDialogState.atom,
    );

    expect(spreadsheetImportDialog.isOpen).toBe(false);
    expect(spreadsheetImportDialog.options).toBeNull();

    await act(async () => {
      result.current.openObjectRecordsSpreadsheetImportDialog();
    });

    const dialogAfterOpen = jotaiStore.get(spreadsheetImportDialogState.atom);

    expect(dialogAfterOpen.isOpen).toBe(true);
    expect(dialogAfterOpen.options).toHaveProperty('onSubmit');
    expect(dialogAfterOpen.options?.onSubmit).toBeInstanceOf(Function);
    expect(dialogAfterOpen.options).toHaveProperty('spreadsheetImportFields');
    expect(
      Array.isArray(dialogAfterOpen.options?.spreadsheetImportFields),
    ).toBe(true);
  });

  it('should route submitted rows through the guided-import pipeline when onSubmit is executed', async () => {
    const { result } = renderHook(
      () => {
        const { openObjectRecordsSpreadsheetImportDialog } =
          useOpenObjectRecordsSpreadsheetImportDialog(
            CoreObjectNameSingular.Company,
          );
        return {
          openObjectRecordsSpreadsheetImportDialog,
        };
      },
      { wrapper: Wrapper },
    );

    await act(async () => {
      result.current.openObjectRecordsSpreadsheetImportDialog();
    });

    const spreadsheetImportDialog = jotaiStore.get(
      spreadsheetImportDialogState.atom,
    );

    const submitData = {
      validStructuredRows: [
        {
          id: COMPANY_ID,
          name: 'Example Company',
          idealCustomerProfile: true,
          employees: '0',
        },
      ],
      invalidStructuredRows: [],
      allStructuredRows: [
        {
          id: COMPANY_ID,
          name: 'Example Company',
          __index: 'cbc3985f-dde9-46d1-bae2-c124141700ac',
          idealCustomerProfile: true,
          employees: '0',
        },
      ],
    };

    await act(async () => {
      await spreadsheetImportDialog.options?.onSubmit(submitData, fakeCsv());
    });

    // Submitted rows are routed through the guided-import staging pipeline
    // (create -> prepare) so extraction results become proposals through the
    // AI write gate, rather than through a direct batch write.
    expect(mockBatchCreateManyRecords).not.toHaveBeenCalled();
    expect(mockPrepareGuidedImport).toHaveBeenCalledTimes(1);

    // The whole point of the review step: submitting the wizard prepares the
    // batch and stops. Nothing is written until a human confirms.
    expect(mockStartGuidedImport).not.toHaveBeenCalled();
    expect(jotaiStore.get(guidedImportReviewState.atom)).toEqual(
      expect.objectContaining({
        importBatchId: 'import-batch-id',
        preview: mockPreview,
      }),
    );

    const callArgs = mockPrepareGuidedImport.mock.calls[0][0];
    expect(callArgs).toHaveProperty('mappedRows');
    expect(Array.isArray(callArgs.mappedRows)).toBe(true);
    expect(callArgs.mappedRows).toHaveLength(1);

    const mappedRow = callArgs.mappedRows[0];
    expect(mappedRow).toHaveProperty('name', 'Example Company');
    expect(mappedRow).toHaveProperty('idealCustomerProfile', true);
    expect(mappedRow).toHaveProperty('employees', 0);
  });
});
