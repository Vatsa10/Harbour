export const INGESTION_SUPPRESSION_KEY = 'INGESTION_SUPPRESSION';

// The tenant-editable layer of the inbound ingestion noise filter. Domains and
// emails listed here never become a Person or a Company, and therefore never
// become a proposal either.
export type IngestionSuppression = {
  suppressedDomains: string[];
  suppressedEmails: string[];
};

export const EMPTY_INGESTION_SUPPRESSION: IngestionSuppression = {
  suppressedDomains: [],
  suppressedEmails: [],
};

export type IngestionSuppressionKeyValueTypeMap = {
  [INGESTION_SUPPRESSION_KEY]: IngestionSuppression;
};
