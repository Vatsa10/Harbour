import { Test, type TestingModule } from '@nestjs/testing';

import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import {
  RECORD_SWEEP_HIGH_VALUE_PRIORITY,
  RECORD_SWEEP_STALE_PRIORITY,
} from 'src/engine/metadata-modules/ai/ai-research/constants/record-sweep.const';
import { AgentTaskService } from 'src/engine/metadata-modules/ai/ai-research/services/agent-task.service';
import { FactService } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
import { RecordSweepService } from 'src/engine/metadata-modules/ai/ai-research/services/record-sweep.service';
import { ResearchAgentService } from 'src/engine/metadata-modules/ai/ai-research/services/research-agent.service';

const WORKSPACE_ID = 'ws-1';
const AGENT_ID = 'agent-1';

describe('RecordSweepService', () => {
  let service: RecordSweepService;

  const factService = { findStaleRecordTargets: jest.fn() };
  const agentTaskService = {
    createTask: jest.fn(),
    findRecordIdsScheduledSince: jest.fn(),
  };
  const researchAgentService = { resolveResearchAgentId: jest.fn() };
  const findRecordsService = { execute: jest.fn() };

  const staleTarget = (recordId: string, objectNameSingular = 'person') => ({
    objectNameSingular,
    recordId,
    lastObservedAt: new Date('2026-01-01T00:00:00.000Z'),
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    factService.findStaleRecordTargets.mockResolvedValue([]);
    findRecordsService.execute.mockResolvedValue({
      success: true,
      result: { records: [] },
    });
    agentTaskService.findRecordIdsScheduledSince.mockResolvedValue(new Set());
    agentTaskService.createTask.mockImplementation(
      async ({ recordId }: { recordId: string }) => ({ id: `task-${recordId}` }),
    );
    researchAgentService.resolveResearchAgentId.mockResolvedValue(AGENT_ID);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordSweepService,
        { provide: FactService, useValue: factService },
        { provide: AgentTaskService, useValue: agentTaskService },
        { provide: ResearchAgentService, useValue: researchAgentService },
        { provide: FindRecordsService, useValue: findRecordsService },
      ],
    }).compile();

    service = module.get(RecordSweepService);
  });

  it('should enqueue a task for a record whose facts have gone stale', async () => {
    factService.findStaleRecordTargets.mockResolvedValue([
      staleTarget('record-1'),
    ]);

    const result = await service.sweepWorkspace({ workspaceId: WORKSPACE_ID });

    expect(result.enqueuedTaskIds).toEqual(['task-record-1']);
    expect(agentTaskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        objectNameSingular: 'person',
        recordId: 'record-1',
        agentId: AGENT_ID,
        priority: RECORD_SWEEP_STALE_PRIORITY,
        idempotencyKey: 'sweep:STALE_FACTS:person:record-1',
      }),
    );
    expect(agentTaskService.createTask.mock.calls[0][0].reason).toContain(
      '2026-01-01',
    );
  });

  it('should enqueue a task for an open opportunity with recent activity', async () => {
    findRecordsService.execute.mockResolvedValue({
      success: true,
      result: { records: [{ id: 'opp-1', stage: 'PROPOSAL' }] },
    });

    const result = await service.sweepWorkspace({ workspaceId: WORKSPACE_ID });

    expect(result.enqueuedTaskIds).toEqual(['task-opp-1']);
    expect(agentTaskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        objectNameSingular: 'opportunity',
        recordId: 'opp-1',
        priority: RECORD_SWEEP_HIGH_VALUE_PRIORITY,
      }),
    );

    // Closed deals are not candidates, and dormant ones are not either.
    const filter = findRecordsService.execute.mock.calls[0][0].filter;

    expect(filter.stage.in).not.toContain('CUSTOMER');
    expect(filter.updatedAt.gte).toBeDefined();
  });

  it('should skip a record that already had a task scheduled inside the cooldown window', async () => {
    factService.findStaleRecordTargets.mockResolvedValue([
      staleTarget('record-1'),
      staleTarget('record-2'),
    ]);
    agentTaskService.findRecordIdsScheduledSince.mockResolvedValue(
      new Set(['record-1']),
    );

    const result = await service.sweepWorkspace({ workspaceId: WORKSPACE_ID });

    expect(result.enqueuedTaskIds).toEqual(['task-record-2']);
    expect(result.skippedForCooldownCount).toBe(1);
  });

  // The policy is the customer's setting, not a hardcoded exemption: an object
  // whose writes can never be approved is not worth spending research budget on.
  it('should not schedule research on an object the write policy forbids', async () => {
    factService.findStaleRecordTargets.mockResolvedValue([
      staleTarget('record-1', 'person'),
      staleTarget('record-2', 'company'),
    ]);

    const result = await service.sweepWorkspace({
      workspaceId: WORKSPACE_ID,
      isObjectSweepable: (objectNameSingular) =>
        objectNameSingular !== 'person',
    });

    expect(result.enqueuedTaskIds).toEqual(['task-record-2']);
    expect(result.skippedForPolicyCount).toBe(1);
    expect(agentTaskService.createTask).toHaveBeenCalledTimes(1);
  });

  it('should schedule one task for a record both lanes selected, keeping the high-value reason', async () => {
    factService.findStaleRecordTargets.mockResolvedValue([
      staleTarget('opp-1', 'opportunity'),
    ]);
    findRecordsService.execute.mockResolvedValue({
      success: true,
      result: { records: [{ id: 'opp-1', stage: 'MEETING' }] },
    });

    const result = await service.sweepWorkspace({ workspaceId: WORKSPACE_ID });

    expect(agentTaskService.createTask).toHaveBeenCalledTimes(1);
    expect(result.enqueuedTaskIds).toEqual(['task-opp-1']);
    expect(agentTaskService.createTask.mock.calls[0][0].priority).toBe(
      RECORD_SWEEP_HIGH_VALUE_PRIORITY,
    );
  });

  it('should cap the number of tasks per tick, keeping the highest-priority candidates', async () => {
    factService.findStaleRecordTargets.mockResolvedValue([
      staleTarget('record-1'),
      staleTarget('record-2'),
    ]);
    findRecordsService.execute.mockResolvedValue({
      success: true,
      result: { records: [{ id: 'opp-1', stage: 'NEW' }] },
    });

    const result = await service.sweepWorkspace({
      workspaceId: WORKSPACE_ID,
      maxTasks: 1,
    });

    expect(result.candidateCount).toBe(3);
    expect(result.enqueuedTaskIds).toEqual(['task-opp-1']);
  });

  // record-crud returns { success: false } rather than throwing. A workspace
  // without the opportunity object must still get its stale lane swept.
  it('should still sweep stale facts when the high-value read fails', async () => {
    factService.findStaleRecordTargets.mockResolvedValue([
      staleTarget('record-1'),
    ]);
    findRecordsService.execute.mockResolvedValue({
      success: false,
      message: 'object not found',
    });

    const result = await service.sweepWorkspace({ workspaceId: WORKSPACE_ID });

    expect(result.enqueuedTaskIds).toEqual(['task-record-1']);
  });

  it('should do nothing, and not resolve an agent, when nothing is selected', async () => {
    const result = await service.sweepWorkspace({ workspaceId: WORKSPACE_ID });

    expect(result.enqueuedTaskIds).toEqual([]);
    expect(result.candidateCount).toBe(0);
    expect(agentTaskService.createTask).not.toHaveBeenCalled();
    expect(researchAgentService.resolveResearchAgentId).not.toHaveBeenCalled();
  });

  // The whole point of the module boundary: this service creates AgentTask rows
  // and nothing else. No record-crud write service is even injectable here.
  it('should never write a CRM record', async () => {
    factService.findStaleRecordTargets.mockResolvedValue([
      staleTarget('record-1'),
    ]);

    await service.sweepWorkspace({ workspaceId: WORKSPACE_ID });

    expect(findRecordsService.execute).toHaveBeenCalledTimes(1);
    expect(findRecordsService.execute.mock.calls[0][0].objectName).toBe(
      'opportunity',
    );
  });
});
