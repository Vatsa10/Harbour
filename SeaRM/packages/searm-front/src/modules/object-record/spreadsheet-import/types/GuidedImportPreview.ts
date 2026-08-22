export type GuidedImportPreview = {
  totalRows: number;
  createCount: number;
  updateCount: number;
  proposeCount: number;
  skipCount: number;
  rowsWithErrorsCount: number;
};

export type GuidedImportReview = {
  importBatchId: string;
  objectNameSingular: string;
  objectNamePlural: string;
  preview: GuidedImportPreview;
};
