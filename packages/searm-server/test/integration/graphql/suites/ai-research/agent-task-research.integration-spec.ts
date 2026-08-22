import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { ToolCategory } from 'searm-shared/ai';

import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { type ToolExecutorService } from 'src/engine/core-modules/tool-provider/services/tool-executor.service';
import { RESEARCH_AGENT_UNIVERSAL_IDENTIFIER } from 'src/engine/metadata-modules/ai/ai-research/constants/research-agent.const';
import { type AgentTaskService } from 'src/engine/metadata-modules/ai/ai-research/services/agent-task.service';
import { type EvidenceRecordingService } from 'src/engine/metadata-modules/ai/ai-research/services/evidence-recording.service';
import { AgentRunStatus } from 'src/engine/metadata-modules/ai/ai-research/types/agent-run-status.type';
import { AgentTaskStatus } from 'src/engine/metadata-modules/ai/ai-research/types/agent-task-status.type';
import { FactStatus } from 'src/engine/metadata-modules/ai/ai-research/types/fact-status.type';
import { type ProposalExecutionService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-execution.service';
import { type UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { SEED_APPLE_WORKSPACE_ID } from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';

import { getAppProviderByClassName } from 'test/integration/utils/get-app-provider-by-class-name.util';

const client = request(`http://localhost:${APP_PORT}`);

const workspaceId = SEED_APPLE_WORKSPACE_ID;

// The value every person fixture starts at. Asserting the record still reads
// this after a gated write is stronger than asserting an empty field: it also
// proves nothing wrote a blank over it.
const INITIAL_JOB_TITLE = 'Sales Rep';

const post = (
  path: '/graphql' | '/metadata',
  query: string,
  variables: Record<string, unknown> = {},
) =>
  client
    .post(path)
    .set('Authorization', `Bearer ${APPLE_JANE_ADMIN_ACCESS_TOKEN}`)
    .send({ query, variables });

const graphqlRequest = (
  query: string,
  variables: Record<string, unknown> = {},
) => post('/graphql', query, variables);

const metadataRequest = (
  query: string,
  variables: Record<string, unknown> = {},
) => post('/metadata', query, variables);

const UPDATE_AI_WRITE_POLICY = `
  mutation UpdateAiWritePolicy($input: UpdateAiWritePolicyInput!) {
    updateAiWritePolicy(input: $input) { default overrides }
  }
`;

// The exact query Task 12's component issues, minus the fields the component
// does not select. If this errors, the approval inbox is broken in production.
const PENDING_PROPOSALS = `
  query PendingProposals {
    pendingProposals {
      id
      status
      items {
        id
        actionType
        objectNameSingular
        recordId
        toolId
        payload
        baseline
        status
        error
        facts {
          id
          fieldName
          strength
          hasConflict
          sourceType
          sourceLocator
          observedAt
        }
      }
    }
  }
`;

const REJECT_PROPOSAL = `
  mutation RejectProposal($input: RejectProposalInput!) {
    rejectProposal(input: $input) { proposalId aborted }
  }
`;

const createPerson = async (): Promise<string> => {
  const id = randomUUID();
  const response = await graphqlRequest(
    `
      mutation CreateOnePerson($input: PersonCreateInput!) {
        createPerson(data: $input) { id jobTitle }
      }
    `,
    { input: { id, jobTitle: INITIAL_JOB_TITLE } },
  );

  expect(response.body.errors).toBeUndefined();

  return response.body.data.createPerson.id;
};

const findPersonJobTitle = async (personId: string): Promise<string | null> => {
  const response = await graphqlRequest(
    `
      query FindOnePerson($filter: PersonFilterInput!) {
        person(filter: $filter) { id jobTitle }
      }
    `,
    { filter: { id: { eq: personId } } },
  );

  expect(response.body.errors).toBeUndefined();

  return response.body.data.person.jobTitle;
};

const setPolicy = async (input: {
  default: string;
  overrides: Record<string, string>;
}) => {
  const response = await metadataRequest(UPDATE_AI_WRITE_POLICY, { input });

  expect(response.body.errors).toBeUndefined();
};

const queryOne = async <T>(sql: string, params: unknown[]): Promise<T> => {
  const [row] = await global.testDataSource.query(sql, params);

  return row as T;
};

describe('agent task research (e2e)', () => {
  let toolExecutorService: ToolExecutorService;
  let agentTaskService: AgentTaskService;
  let evidenceRecordingService: EvidenceRecordingService;
  let proposalExecutionService: ProposalExecutionService;
  let toolProviderContext: ToolProviderContext;
  let approverUserWorkspaceId: string;
  let agentId: string;
  let personId: string;

  beforeAll(async () => {
    toolExecutorService = getAppProviderByClassName<ToolExecutorService>(
      'ToolExecutorService',
    );
    agentTaskService =
      getAppProviderByClassName<AgentTaskService>('AgentTaskService');
    evidenceRecordingService =
      getAppProviderByClassName<EvidenceRecordingService>(
        'EvidenceRecordingService',
      );
    proposalExecutionService =
      getAppProviderByClassName<ProposalExecutionService>(
        'ProposalExecutionService',
      );

    const userRoleService =
      getAppProviderByClassName<UserRoleService>('UserRoleService');

    const adminUserWorkspace = await queryOne<{
      userWorkspaceId: string;
      userId: string;
    }>(
      `SELECT uw.id AS "userWorkspaceId", u.id AS "userId"
       FROM core."userWorkspace" uw
       JOIN core."user" u ON u.id = uw."userId"
       WHERE uw."workspaceId" = $1 AND u.email = $2`,
      [workspaceId, 'jane.austen@apple.dev'],
    );

    approverUserWorkspaceId = adminUserWorkspace.userWorkspaceId;

    const roleId = await userRoleService.getRoleIdForUserWorkspace({
      userWorkspaceId: approverUserWorkspaceId,
      workspaceId,
    });

    toolProviderContext = {
      workspaceId,
      roleId,
      rolePermissionConfig: { shouldBypassPermissionChecks: true },
      userId: adminUserWorkspace.userId,
      userWorkspaceId: approverUserWorkspaceId,
      threadId: randomUUID(),
    };

    // Owner Decision 4: the seeded research agent. No fixture is created —
    // if this row is missing, Task 5b's declarative seed is not working and
    // that is the failure this assertion should surface.
    const seededAgent = await queryOne<{ id: string }>(
      `SELECT id FROM core."agent"
       WHERE "workspaceId" = $1 AND "universalIdentifier" = $2`,
      [workspaceId, RESEARCH_AGENT_UNIVERSAL_IDENTIFIER],
    );

    expect(seededAgent).toBeDefined();
    agentId = seededAgent.id;
  });

  beforeEach(async () => {
    await setPolicy({ default: 'PROPOSE', overrides: {} });
    personId = await createPerson();
    // Fresh thread per test so proposals don't merge across tests.
    toolProviderContext = { ...toolProviderContext, threadId: randomUUID() };
  });

  const dispatchUpdateJobTitle = (jobTitle: string) =>
    toolExecutorService.dispatch(
      {
        name: 'update_one_person',
        label: 'update_one',
        description: '',
        category: ToolCategory.DATABASE_CRUD,
        executionRef: {
          kind: 'database_crud',
          objectNameSingular: 'person',
          operation: 'update_one',
        },
      },
      { id: personId, jobTitle },
      toolProviderContext,
    );

  const dispatchStaticTool = (toolId: string, args: Record<string, unknown>) =>
    toolExecutorService.dispatch(
      {
        name: toolId,
        label: toolId,
        description: '',
        category: ToolCategory.ACTION,
        executionRef: { kind: 'static', toolId },
      },
      args,
      toolProviderContext,
    );

  // Stands in for what AgentTaskRunJob creates, without a real LLM turn.
  const insertAgentRun = async (taskId: string): Promise<string> => {
    const run = await queryOne<{ id: string }>(
      `INSERT INTO core."agentRun" ("workspaceId", "taskId", "agentId", status)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [workspaceId, taskId, agentId, AgentRunStatus.RUNNING],
    );

    return run.id;
  };

  const findFacts = (recordId: string, fieldName: string) =>
    global.testDataSource.query(
      `SELECT id, status, strength, "lastObservedAt" FROM core."fact"
       WHERE "workspaceId" = $1 AND "recordId" = $2 AND "fieldName" = $3`,
      [workspaceId, recordId, fieldName],
    ) as Promise<
      { id: string; status: string; strength: string; lastObservedAt: Date }[]
    >;

  // ---- the exit gate, in one test ----

  it('records evidence, derives a fact, proposes with a citation, and applies once on approval', async () => {
    const task = await agentTaskService.createTask({
      workspaceId,
      objectNameSingular: 'person',
      recordId: personId,
      agentId,
      reason: 'New lead created',
    });

    expect(task.status).toBe(AgentTaskStatus.PENDING);

    const claimed = await agentTaskService.claimDueTasks();
    const claimedTask = claimed.find((candidate) => candidate.id === task.id);

    expect(claimedTask).toBeDefined();
    expect(claimedTask?.status).toBe(AgentTaskStatus.LEASED);

    const runId = await insertAgentRun(task.id);

    // C1's real-seam check, part 1: record_evidence must NOT be gated. This
    // goes through the live dispatcher, so a missing denylist entry turns
    // this into a proposal and the assertions below fail loudly.
    const evidenceOutput = await dispatchStaticTool('record_evidence', {
      objectNameSingular: 'person',
      recordId: personId,
      fieldName: 'jobTitle',
      value: 'Head of Sales',
      sourceType: 'WEB_SEARCH',
      // Recorded by the test harness, not by a model.
      assertedBy: 'SERVER',
      sourceLocator: 'https://example.com/about',
    });

    expect(evidenceOutput.success).toBe(true);
    expect(
      (evidenceOutput.result as { proposalId?: string }).proposalId,
    ).toBeUndefined();
    expect(
      (evidenceOutput.result as { evidenceId?: string }).evidenceId,
    ).toBeDefined();

    const facts = await findFacts(personId, 'jobTitle');

    expect(facts).toHaveLength(1);
    expect(facts[0].status).toBe(FactStatus.CURRENT);
    expect(facts[0].strength).toBe('WEAK');

    // The agent's proposing write. This one IS gated.
    const updateOutput = await dispatchUpdateJobTitle('Head of Sales');
    const { proposalId, proposalItemId } = updateOutput.result as {
      proposalId: string;
      proposalItemId: string;
    };

    expect(updateOutput.success).toBe(true);
    expect(await findPersonJobTitle(personId)).toBe(INITIAL_JOB_TITLE);

    // The citation, through the exact query the approval UI issues.
    const pending = await metadataRequest(PENDING_PROPOSALS);

    expect(pending.body.errors).toBeUndefined();

    const proposal = pending.body.data.pendingProposals.find(
      (candidate: { id: string }) => candidate.id === proposalId,
    );
    const item = proposal.items.find(
      (candidate: { id: string }) => candidate.id === proposalItemId,
    );

    expect(item.facts).toHaveLength(1);
    expect(item.facts[0]).toMatchObject({
      fieldName: 'jobTitle',
      strength: 'WEAK',
      hasConflict: false,
      sourceType: 'WEB_SEARCH',
      // Recorded by the test harness, not by a model.
      assertedBy: 'SERVER',
      sourceLocator: 'https://example.com/about',
    });

    await agentTaskService.completeTask({
      taskId: task.id,
      workspaceId,
      runId,
      outcome: 'Found job title.',
    });

    const completed = await queryOne<{ status: string }>(
      `SELECT status FROM core."agentTask" WHERE id = $1`,
      [task.id],
    );

    expect(completed.status).toBe(AgentTaskStatus.SUCCEEDED);

    const approval = await proposalExecutionService.approve({
      proposalId,
      selectedItemIds: [proposalItemId],
      workspaceId,
      approverUserWorkspaceId,
    });

    expect(approval.aborted).toBe(false);
    expect(approval.appliedItemIds).toEqual([proposalItemId]);
    expect(await findPersonJobTitle(personId)).toBe('Head of Sales');
  });

  // C1's real-seam check, part 2, and Task 5c's deferred coverage.
  it('schedules research through the ungated create_agent_task tool without creating a proposal', async () => {
    const output = await dispatchStaticTool('create_agent_task', {
      objectNameSingular: 'person',
      recordId: personId,
      reason: 'Tool-scheduled research',
    });

    expect(output.success).toBe(true);
    expect(
      (output.result as { proposalId?: string }).proposalId,
    ).toBeUndefined();

    const { taskId } = output.result as { taskId: string };
    const scheduled = await queryOne<{ status: string; agentId: string }>(
      `SELECT status, "agentId" FROM core."agentTask" WHERE id = $1`,
      [taskId],
    );

    expect(scheduled.status).toBe(AgentTaskStatus.PENDING);
    // The seeded agent, not one the model chose.
    expect(scheduled.agentId).toBe(agentId);

    // Called twice with the same inputs, one task.
    const second = await dispatchStaticTool('create_agent_task', {
      objectNameSingular: 'person',
      recordId: personId,
      reason: 'Tool-scheduled research',
    });

    expect((second.result as { taskId: string }).taskId).toBe(taskId);
  });

  it('retries with real backoff and then gives up naming the attempt count', async () => {
    const task = await agentTaskService.createTask({
      workspaceId,
      objectNameSingular: 'person',
      recordId: personId,
      agentId,
      reason: 'Retry coverage',
      maxAttempts: 2,
    });

    await agentTaskService.claimDueTasks();
    await agentTaskService.failTask({
      taskId: task.id,
      workspaceId,
      runId: randomUUID(),
      errorMessage: 'transient error',
    });

    const afterFirstFailure = await queryOne<{ status: string; dueAt: Date }>(
      `SELECT status, "dueAt" FROM core."agentTask" WHERE id = $1`,
      [task.id],
    );

    expect(afterFirstFailure.status).toBe(AgentTaskStatus.PENDING);
    expect(new Date(afterFirstFailure.dueAt).getTime()).toBeGreaterThan(
      Date.now(),
    );

    // The backoff is real, not a no-op: the task is not immediately re-claimable.
    const immediateClaim = await agentTaskService.claimDueTasks();

    expect(immediateClaim.some((candidate) => candidate.id === task.id)).toBe(
      false,
    );

    // Advance past the backoff rather than sleeping through it.
    await global.testDataSource.query(
      `UPDATE core."agentTask" SET "dueAt" = now() - interval '1 minute' WHERE id = $1`,
      [task.id],
    );

    const secondClaim = await agentTaskService.claimDueTasks();

    expect(secondClaim.some((candidate) => candidate.id === task.id)).toBe(
      true,
    );

    await agentTaskService.failTask({
      taskId: task.id,
      workspaceId,
      runId: randomUUID(),
      errorMessage: 'transient error',
    });

    const exhausted = await queryOne<{ status: string; outcome: string }>(
      `SELECT status, outcome FROM core."agentTask" WHERE id = $1`,
      [task.id],
    );

    expect(exhausted.status).toBe(AgentTaskStatus.FAILED);
    expect(exhausted.outcome).toContain('Gave up after 2 attempts');
  });

  // "Survives restart": a worker that died mid-run leaves the row LEASED with
  // a lease that later expires. Nothing resets its status — no crashed-worker
  // detector exists and none is wanted — so the claim query itself must treat
  // an expired lease as claimable. The UPDATE below writes only "leasedUntil":
  // rewriting `status` to PENDING would simulate a *rescheduled* task, not a
  // crashed worker, and would pass against a PENDING-only claim query that
  // strands every real crash. Do not weaken it.
  it('re-claims a task whose lease expired while it was still marked LEASED', async () => {
    const task = await agentTaskService.createTask({
      workspaceId,
      objectNameSingular: 'person',
      recordId: personId,
      agentId,
      reason: 'Restart coverage',
    });

    const firstClaim = await agentTaskService.claimDueTasks();

    expect(
      firstClaim.find((candidate) => candidate.id === task.id)?.status,
    ).toBe(AgentTaskStatus.LEASED);

    await global.testDataSource.query(
      `UPDATE core."agentTask"
       SET "leasedUntil" = now() - interval '1 hour'
       WHERE id = $1`,
      [task.id],
    );

    const stillLeased = await queryOne<{ status: string }>(
      `SELECT status FROM core."agentTask" WHERE id = $1`,
      [task.id],
    );

    expect(stillLeased.status).toBe(AgentTaskStatus.LEASED);

    const reclaimed = await agentTaskService.claimDueTasks();
    const reclaimedTask = reclaimed.find(
      (candidate) => candidate.id === task.id,
    );

    expect(reclaimedTask).toBeDefined();
    expect(Number(reclaimedTask?.attempts)).toBe(2);
  });

  // The other half of the expired-lease rule: an unexpired lease must NOT be
  // re-claimable, or two workers run the same research task concurrently.
  it('does not re-claim a LEASED task whose lease is still in the future', async () => {
    const task = await agentTaskService.createTask({
      workspaceId,
      objectNameSingular: 'person',
      recordId: personId,
      agentId,
      reason: 'Concurrent-claim coverage',
    });

    await agentTaskService.claimDueTasks();

    const secondClaim = await agentTaskService.claimDueTasks();

    expect(
      secondClaim.find((candidate) => candidate.id === task.id),
    ).toBeUndefined();
  });

  // A row that crashed maxAttempts times is no longer claimable but is also
  // not terminal. Without the reaper it sits LEASED forever and no operator
  // surface ever shows it as failed.
  it('reaps a LEASED task whose lease expired after its attempts were exhausted', async () => {
    const task = await agentTaskService.createTask({
      workspaceId,
      objectNameSingular: 'person',
      recordId: personId,
      agentId,
      reason: 'Reaper coverage',
      maxAttempts: 1,
    });

    await agentTaskService.claimDueTasks();

    await global.testDataSource.query(
      `UPDATE core."agentTask"
       SET "leasedUntil" = now() - interval '1 hour'
       WHERE id = $1`,
      [task.id],
    );

    expect(await agentTaskService.claimDueTasks()).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ id: task.id })]),
    );

    const reaped = await agentTaskService.reapAbandonedTasks();

    expect(reaped).toBeGreaterThanOrEqual(1);

    const reapedRow = await queryOne<{ status: string; outcome: string }>(
      `SELECT status, outcome FROM core."agentTask" WHERE id = $1`,
      [task.id],
    );

    expect(reapedRow.status).toBe(AgentTaskStatus.FAILED);
    expect(reapedRow.outcome).toContain('Abandoned after 1 attempts');
  });

  it('never claims a cancelled task', async () => {
    const task = await agentTaskService.createTask({
      workspaceId,
      objectNameSingular: 'person',
      recordId: personId,
      agentId,
      reason: 'Cancellation coverage',
    });

    const cancelled = await agentTaskService.cancelTask({
      taskId: task.id,
      workspaceId,
      reason: 'Record deleted',
    });

    expect(cancelled).toBe(true);

    const claimed = await agentTaskService.claimDueTasks();

    expect(claimed.some((candidate) => candidate.id === task.id)).toBe(false);

    // A second cancel changes nothing and says so.
    expect(
      await agentTaskService.cancelTask({
        taskId: task.id,
        workspaceId,
        reason: 'Record deleted',
      }),
    ).toBe(false);
  });

  // Task 9's and Task 2's deferred real-seam coverage: the whole dismissal
  // loop, against a real database. This is the only place it is proven.
  it('does not re-propose a value the reviewer rejected', async () => {
    const runId = randomUUID();

    await evidenceRecordingService.recordEvidence({
      workspaceId,
      runId: null,
      objectNameSingular: 'person',
      recordId: personId,
      sourceType: 'WEB_SEARCH',
      // Recorded by the test harness, not by a model.
      assertedBy: 'SERVER',
      sourceLocator: 'https://example.com/about',
      extractor: `agent-run:${runId}`,
      payload: { fieldName: 'jobTitle', value: 'Head of Sales' },
    });

    const update = await dispatchUpdateJobTitle('Head of Sales');
    const { proposalId } = update.result as { proposalId: string };

    const rejection = await metadataRequest(REJECT_PROPOSAL, {
      input: { proposalId },
    });

    expect(rejection.body.errors).toBeUndefined();
    expect(rejection.body.data.rejectProposal.aborted).toBe(false);

    const afterReject = await findFacts(personId, 'jobTitle');

    expect(afterReject).toHaveLength(1);
    expect(afterReject[0].status).toBe(FactStatus.DISMISSED);

    // Observe the identical value again. No new CURRENT fact may appear.
    await evidenceRecordingService.recordEvidence({
      workspaceId,
      runId: null,
      objectNameSingular: 'person',
      recordId: personId,
      sourceType: 'WEB_SEARCH',
      // Recorded by the test harness, not by a model.
      assertedBy: 'SERVER',
      sourceLocator: 'https://example.com/team',
      extractor: `agent-run:${randomUUID()}`,
      payload: { fieldName: 'jobTitle', value: 'Head of Sales' },
    });

    const afterReobservation = await findFacts(personId, 'jobTitle');

    expect(
      afterReobservation.filter((fact) => fact.status === FactStatus.CURRENT),
    ).toHaveLength(0);

    // A *different* value is still proposable — dismissal is per value, not
    // per field. Without this the "don't nag" rule would silence the field.
    await evidenceRecordingService.recordEvidence({
      workspaceId,
      runId: null,
      objectNameSingular: 'person',
      recordId: personId,
      sourceType: 'WEB_SEARCH',
      // Recorded by the test harness, not by a model.
      assertedBy: 'SERVER',
      sourceLocator: 'https://example.com/news',
      extractor: `agent-run:${randomUUID()}`,
      payload: { fieldName: 'jobTitle', value: 'VP of Sales' },
    });

    const afterNewValue = await findFacts(personId, 'jobTitle');

    expect(
      afterNewValue.filter((fact) => fact.status === FactStatus.CURRENT),
    ).toHaveLength(1);
  });
});
