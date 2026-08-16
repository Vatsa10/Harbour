// Mirrors SPREADSHEET_MAX_RECORD_IMPORT_CAPACITY in twenty-front. The client
// check is a courtesy; this one is the actual limit, because the mutation is
// reachable without the wizard and rawRows/mappedRows are unbounded jsonb
// arrays inserted in a single statement.
export const IMPORT_BATCH_MAX_ROWS = 10000;
