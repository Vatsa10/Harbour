// Exposed through GraphQL (Task 11), so this is a real enum per the
// string-literal-unions-except-GraphQL-enums rule.
export enum FactStatus {
  CURRENT = 'CURRENT',
  SUPERSEDED = 'SUPERSEDED',
  DISMISSED = 'DISMISSED',
}
