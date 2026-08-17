import { Client } from 'pg';

import { evaluateRecordScope } from 'src/engine/twenty-orm/record-scope/evaluate-record-scope.util';
import { renderRecordScopeToSql } from 'src/engine/twenty-orm/record-scope/render-record-scope-to-sql.util';

import {
  COLUMN_NAMES_BY_FIELD_METADATA_ID as columnNamesByFieldMetadataId,
  PRINCIPAL as principal,
  RECORD_SCOPE_CASES,
} from './record-scope-cases';

// The write-side guard evaluates a scope in memory; the query builders evaluate
// the same scope in Postgres. If they disagree on even one row the user writes
// a record they cannot then read, so every case is asserted against both.
// This spec talks to Postgres directly rather than through the integration
// harness because it needs no schema at all - only expression semantics.
const connectionString =
  process.env.PG_DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5433/postgres';

describe('record scope evaluator parity', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it.each(RECORD_SCOPE_CASES)(
    '$name should evaluate to $expected in memory and in postgres alike',
    async ({ node, row, expected }) => {
      expect(
        evaluateRecordScope({
          node,
          record: row,
          columnNamesByFieldMetadataId,
          principal,
        }),
      ).toBe(expected);

      const rendered = renderRecordScopeToSql({
        node,
        tableAlias: 't',
        columnNamesByFieldMetadataId,
        principal,
        parameterPrefix: 'p',
      });

      // Rebind the renderer's named parameters onto positional ones starting
      // after the two row columns, keeping the SQL text itself untouched.
      const names = Object.keys(rendered.parameters);
      const sql = rendered.sql.replace(
        /:(\w+)/g,
        (_match, name: string) => `$${names.indexOf(name) + 3}`,
      );

      const result = await client.query(
        `SELECT ${sql} AS matched FROM (SELECT $1::text AS region, $2::text AS "ownerId") t`,
        [row.region, row.ownerId, ...names.map((name) => rendered.parameters[name])],
      );

      expect(result.rows[0].matched).toBe(expected);
    },
  );
});
