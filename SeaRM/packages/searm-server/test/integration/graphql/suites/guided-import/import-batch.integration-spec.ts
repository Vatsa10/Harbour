import { randomUUID } from 'node:crypto';

import request from 'supertest';

import {
  SEED_APPLE_WORKSPACE_ID,
  SEED_YCOMBINATOR_WORKSPACE_ID,
} from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';

import { waitForAllJobsToFinish } from 'test/integration/utils/wait-for-all-jobs-to-finish.util';

const client = request(`http://localhost:${APP_PORT}`);

const CREATE_IMPORT_BATCH = `
  mutation CreateImportBatch($input: CreateImportBatchInput!) {
    createImportBatch(input: $input) { id status totalRows }
  }
`;

const PREPARE_IMPORT_BATCH = `
  mutation PrepareImportBatch($importBatchId: String!) {
    prepareImportBatch(importBatchId: $importBatchId) { id status }
  }
`;

const IMPORT_BATCH_PREVIEW = `
  query ImportBatchPreview($importBatchId: String!) {
    importBatchPreview(importBatchId: $importBatchId) {
      totalRows createCount updateCount proposeCount skipCount rowsWithErrorsCount
    }
  }
`;

const START_IMPORT_BATCH = `
  mutation StartImportBatch($importBatchId: String!) {
    startImportBatch(importBatchId: $importBatchId) { id status }
  }
`;

const post = (
  path: '/graphql' | '/metadata',
  query: string,
  variables: Record<string, unknown> = {},
) =>
  client
    .post(path)
    .set('Authorization', `Bearer ${APPLE_JANE_ADMIN_ACCESS_TOKEN}`)
    .send({ query, variables });

// Record CRUD lives on the core schema; the guided-import resolver is a
// @MetadataResolver() and is served from /metadata.
const graphqlRequest = (
  query: string,
  variables: Record<string, unknown> = {},
) => post('/graphql', query, variables);

const metadataRequest = (
  query: string,
  variables: Record<string, unknown> = {},
) => post('/metadata', query, variables);

// A domain unique to this run so the suite never collides with dev-seed data
// or with a previous run left in the database.
const RUN_SUFFIX = randomUUID().slice(0, 8);
const DOMAIN = `acme-${RUN_SUFFIX}.test`;
const EXISTING_EMAIL = `existing@${DOMAIN}`;
const NEW_EMAIL = `newperson@${DOMAIN}`;
const AMBIGUOUS_EMAIL = `existing.alt@${DOMAIN}`;

type PersonRow = {
  id: string;
  jobTitle: string;
  emails: { primaryEmail: string };
};

const createCompany = async (): Promise<string> => {
  const id = randomUUID();
  const response = await graphqlRequest(
    `
      mutation CreateOneCompany($input: CompanyCreateInput!) {
        createCompany(data: $input) { id }
      }
    `,
    {
      input: {
        id,
        name: `Acme ${RUN_SUFFIX}`,
        domainName: { primaryLinkUrl: DOMAIN },
      },
    },
  );

  expect(response.body.errors).toBeUndefined();

  return response.body.data.createCompany.id;
};

const createPerson = async (input: Record<string, unknown>): Promise<string> => {
  const id = randomUUID();
  const response = await graphqlRequest(
    `
      mutation CreateOnePerson($input: PersonCreateInput!) {
        createPerson(data: $input) { id }
      }
    `,
    { input: { id, ...input } },
  );

  expect(response.body.errors).toBeUndefined();

  return response.body.data.createPerson.id;
};

const findPeopleByEmail = async (email: string): Promise<PersonRow[]> => {
  const response = await graphqlRequest(
    `
      query FindManyPeople($filter: PersonFilterInput!) {
        people(filter: $filter) {
          edges { node { id jobTitle emails { primaryEmail } } }
        }
      }
    `,
    { filter: { emails: { primaryEmail: { eq: email } } } },
  );

  expect(response.body.errors).toBeUndefined();

  return response.body.data.people.edges.map(
    (edge: { node: PersonRow }) => edge.node,
  );
};

const createBatch = async (
  mappedRows: Record<string, unknown>[],
): Promise<{ id: string; status: string; totalRows: number }> => {
  const response = await metadataRequest(CREATE_IMPORT_BATCH, {
    input: {
      objectNameSingular: 'person',
      fileName: `people-${RUN_SUFFIX}.csv`,
      rawRows: mappedRows.map((row) => ({ raw: JSON.stringify(row) })),
      mappedRows,
      columnMapping: { Email: 'emails', 'Job Title': 'jobTitle' },
    },
  });

  expect(response.body.errors).toBeUndefined();

  return response.body.data.createImportBatch;
};

const prepareAndPreview = async (importBatchId: string) => {
  const prepared = await metadataRequest(PREPARE_IMPORT_BATCH, {
    importBatchId,
  });

  expect(prepared.body.errors).toBeUndefined();
  expect(prepared.body.data.prepareImportBatch.status).toBe('READY');

  const preview = await metadataRequest(IMPORT_BATCH_PREVIEW, {
    importBatchId,
  });

  expect(preview.body.errors).toBeUndefined();

  return preview.body.data.importBatchPreview;
};

const startAndDrain = async (importBatchId: string) => {
  const started = await metadataRequest(START_IMPORT_BATCH, { importBatchId });

  expect(started.body.errors).toBeUndefined();
  expect(started.body.data.startImportBatch.status).toBe('RUNNING');

  // The import runs on the real importQueue; drain it before asserting.
  await waitForAllJobsToFinish();
};

const findProposalsForBatch = async (
  importBatchId: string,
): Promise<{ id: string; sourceKey: string; workspaceId: string }[]> =>
  global.testDataSource.query(
    `SELECT id, "sourceKey", "workspaceId" FROM core."proposal"
     WHERE "sourceKey" LIKE $1 ORDER BY "createdAt" ASC`,
    [`import:${importBatchId}:%`],
  );

describe('guided import (e2e)', () => {
  let setupPersonId: string;
  let ambiguousBatchId: string;

  beforeAll(async () => {
    const companyId = await createCompany();

    setupPersonId = await createPerson({
      emails: { primaryEmail: EXISTING_EMAIL },
      name: { firstName: 'Existing', lastName: 'Person' },
      jobTitle: 'Sales Manager',
      companyId,
    });
  });

  it('creates a PENDING batch with one row per mapped row', async () => {
    const batch = await createBatch([
      { emails: { primaryEmail: EXISTING_EMAIL }, jobTitle: 'VP Sales' },
      { emails: { primaryEmail: NEW_EMAIL } },
    ]);

    expect(batch).toEqual(
      expect.objectContaining({ totalRows: 2, status: 'PENDING' }),
    );

    const preview = await prepareAndPreview(batch.id);

    expect(preview).toEqual(
      expect.objectContaining({
        totalRows: 2,
        updateCount: 1,
        createCount: 1,
        proposeCount: 0,
        rowsWithErrorsCount: 0,
      }),
    );

    await startAndDrain(batch.id);

    const [updatedPerson] = await findPeopleByEmail(EXISTING_EMAIL);

    expect(updatedPerson.id).toBe(setupPersonId);
    expect(updatedPerson.jobTitle).toBe('VP Sales');

    const newPeople = await findPeopleByEmail(NEW_EMAIL);

    expect(newPeople).toHaveLength(1);

    // No proposal for an EXACT match — it is a deterministic direct write.
    expect(await findProposalsForBatch(batch.id)).toHaveLength(0);
  });

  it('proposes rather than writes when the row only matches by name and domain', async () => {
    const batch = await createBatch([
      {
        emails: { primaryEmail: AMBIGUOUS_EMAIL },
        name: { firstName: 'Existing', lastName: 'Person' },
        jobTitle: 'Chief Revenue Officer',
      },
    ]);

    ambiguousBatchId = batch.id;

    const preview = await prepareAndPreview(batch.id);

    expect(preview).toEqual(
      expect.objectContaining({
        totalRows: 1,
        createCount: 0,
        updateCount: 0,
        proposeCount: 1,
        rowsWithErrorsCount: 0,
      }),
    );

    await startAndDrain(batch.id);

    const proposals = await findProposalsForBatch(batch.id);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].sourceKey).toBe(`import:${batch.id}:1`);
    expect(proposals[0].workspaceId).toBe(SEED_APPLE_WORKSPACE_ID);

    const [items] = await global.testDataSource.query(
      `SELECT "actionType", "objectNameSingular", "recordId", payload
       FROM core."proposalItem" WHERE "proposalId" = $1`,
      [proposals[0].id],
    );

    expect(items.actionType).toBe('UPDATE_RECORD');
    expect(items.objectNameSingular).toBe('person');
    expect(items.recordId).toBe(setupPersonId);
    expect(items.payload.jobTitle).toBe('Chief Revenue Officer');

    // Nothing was written directly: the CANDIDATE row must not touch the
    // record, and no second person may be created for the alt email.
    const [setupPerson] = await findPeopleByEmail(EXISTING_EMAIL);

    expect(setupPerson.jobTitle).toBe('VP Sales');
    expect(await findPeopleByEmail(AMBIGUOUS_EMAIL)).toHaveLength(0);
  });

  // A BullMQ retry replays the job over rows it already claimed. Rows are
  // reset to PENDING here to reproduce a crash that lost the row-status write
  // but kept the proposal — the only case where a duplicate could appear.
  it('creates no second proposal when the import job is retried', async () => {
    await global.testDataSource.query(
      `UPDATE core."importRow" SET status = 'PENDING', "processedAt" = NULL
       WHERE "importBatchId" = $1`,
      [ambiguousBatchId],
    );
    await global.testDataSource.query(
      `UPDATE core."importBatch" SET status = 'READY' WHERE id = $1`,
      [ambiguousBatchId],
    );

    await startAndDrain(ambiguousBatchId);

    const proposals = await findProposalsForBatch(ambiguousBatchId);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].sourceKey).toBe(`import:${ambiguousBatchId}:1`);
  });

  // Phase 3 exit gate, cross-workspace clause: another workspace's proposal
  // carrying a colliding sourceKey must neither suppress ours nor be touched.
  it('scopes proposal idempotency and writes to the importing workspace', async () => {
    const foreignProposalId = randomUUID();
    const foreignBatchId = randomUUID();

    await global.testDataSource.query(
      `INSERT INTO core."proposal" (id, "workspaceId", status, "sourceKey", "expiresAt")
       VALUES ($1, $2, 'PENDING', $3, now() + interval '7 days')`,
      [
        foreignProposalId,
        SEED_YCOMBINATOR_WORKSPACE_ID,
        `import:${foreignBatchId}:1`,
      ],
    );

    const batch = await createBatch([
      {
        emails: { primaryEmail: `second.alt@${DOMAIN}` },
        name: { firstName: 'Existing', lastName: 'Person' },
        jobTitle: 'Regional Director',
      },
    ]);

    const preview = await prepareAndPreview(batch.id);

    expect(preview.proposeCount).toBe(1);

    await startAndDrain(batch.id);

    const proposals = await findProposalsForBatch(batch.id);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].workspaceId).toBe(SEED_APPLE_WORKSPACE_ID);

    const [foreignProposal] = await global.testDataSource.query(
      `SELECT "workspaceId", status FROM core."proposal" WHERE id = $1`,
      [foreignProposalId],
    );

    expect(foreignProposal.workspaceId).toBe(SEED_YCOMBINATOR_WORKSPACE_ID);
    expect(foreignProposal.status).toBe('PENDING');

    await global.testDataSource.query(
      `DELETE FROM core."proposal" WHERE id = $1`,
      [foreignProposalId],
    );
  });

  // The other half of the cross-workspace clause: a batch id belonging to
  // another workspace must not be readable or runnable with our token.
  it('refuses to start or preview a batch belonging to another workspace', async () => {
    const foreignBatchId = randomUUID();

    await global.testDataSource.query(
      `INSERT INTO core."importBatch"
         (id, "workspaceId", "objectNameSingular", "fileName", status, "totalRows")
       VALUES ($1, $2, 'person', 'foreign.csv', 'READY', 1)`,
      [foreignBatchId, SEED_YCOMBINATOR_WORKSPACE_ID],
    );

    const started = await metadataRequest(START_IMPORT_BATCH, {
      importBatchId: foreignBatchId,
    });

    expect(started.body.errors).toBeDefined();
    expect(started.body.data?.startImportBatch).toBeFalsy();

    const preview = await metadataRequest(IMPORT_BATCH_PREVIEW, {
      importBatchId: foreignBatchId,
    });

    expect(preview.body.errors).toBeDefined();
    expect(preview.body.data?.importBatchPreview).toBeFalsy();

    const [untouched] = await global.testDataSource.query(
      `SELECT status FROM core."importBatch" WHERE id = $1`,
      [foreignBatchId],
    );

    expect(untouched.status).toBe('READY');

    await global.testDataSource.query(
      `DELETE FROM core."importBatch" WHERE id = $1`,
      [foreignBatchId],
    );
  });
});
