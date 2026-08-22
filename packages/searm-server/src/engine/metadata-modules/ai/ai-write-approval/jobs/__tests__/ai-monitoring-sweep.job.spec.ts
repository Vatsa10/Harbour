import { Test, type TestingModule } from '@nestjs/testing';

import { RecordSweepService } from 'src/engine/metadata-modules/ai/ai-research/services/record-sweep.service';
import { AiMonitoringSweepJob } from 'src/engine/metadata-modules/ai/ai-write-approval/jobs/ai-monitoring-sweep.job';
import { AiWritePolicyService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/ai-write-policy.service';
import { ProposalSupersessionService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-supersession.service';
import { type AiWritePolicy } from 'src/engine/metadata-modules/ai/ai-write-approval/types/ai-write-policy.type';

const WORKSPACE_ID = 'ws-1';

describe('AiMonitoringSweepJob', () => {
  let job: AiMonitoringSweepJob;

  const proposalSupersessionService = { sweepWorkspace: jest.fn() };
  const recordSweepService = { sweepWorkspace: jest.fn() };

  // The real resolver, not a stub: the behaviour under test is "the sweep
  // honours the policy", and a stubbed resolveMode would test the stub.
  const realPolicyService = new AiWritePolicyService(
    {} as never,
  ) as AiWritePolicyService;

  const aiWritePolicyService = {
    getPolicy: jest.fn(),
    resolveMode: realPolicyService.resolveMode.bind(realPolicyService),
  };

  const setPolicy = (policy: AiWritePolicy) =>
    aiWritePolicyService.getPolicy.mockResolvedValue(policy);

  const capturedFilter = (): ((objectNameSingular: string) => boolean) =>
    recordSweepService.sweepWorkspace.mock.calls[0][0].isObjectSweepable;

  beforeEach(async () => {
    jest.clearAllMocks();
    proposalSupersessionService.sweepWorkspace.mockResolvedValue({
      supersededItemIds: [],
      supersededProposalIds: [],
    });
    recordSweepService.sweepWorkspace.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      candidateCount: 0,
      enqueuedTaskIds: [],
      skippedForCooldownCount: 0,
      skippedForPolicyCount: 0,
    });
    setPolicy({ default: 'PROPOSE', overrides: {} });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiMonitoringSweepJob,
        {
          provide: ProposalSupersessionService,
          useValue: proposalSupersessionService,
        },
        { provide: RecordSweepService, useValue: recordSweepService },
        { provide: AiWritePolicyService, useValue: aiWritePolicyService },
      ],
    }).compile();

    job = module.get(AiMonitoringSweepJob);
  });

  it('should retire stale proposals before selecting new work', async () => {
    const order: string[] = [];

    proposalSupersessionService.sweepWorkspace.mockImplementation(async () => {
      order.push('supersession');

      return { supersededItemIds: [], supersededProposalIds: [] };
    });
    recordSweepService.sweepWorkspace.mockImplementation(async () => {
      order.push('record-sweep');

      return {
        workspaceId: WORKSPACE_ID,
        candidateCount: 0,
        enqueuedTaskIds: [],
        skippedForCooldownCount: 0,
        skippedForPolicyCount: 0,
      };
    });

    await job.handle({ workspaceId: WORKSPACE_ID });

    expect(order).toEqual(['supersession', 'record-sweep']);
    expect(proposalSupersessionService.sweepWorkspace).toHaveBeenCalledWith(
      WORKSPACE_ID,
    );
  });

  it('should pass a policy filter that rejects an object-level FORBID', async () => {
    setPolicy({ default: 'PROPOSE', overrides: { person: 'FORBID' } });

    await job.handle({ workspaceId: WORKSPACE_ID });

    expect(capturedFilter()('person')).toBe(false);
    expect(capturedFilter()('company')).toBe(true);
  });

  // Default FORBID is a real configuration, and a deny list cannot express it.
  it('should reject every object when the workspace default is FORBID, except a relaxed one', async () => {
    setPolicy({ default: 'FORBID', overrides: { opportunity: 'PROPOSE' } });

    await job.handle({ workspaceId: WORKSPACE_ID });

    expect(capturedFilter()('person')).toBe(false);
    expect(capturedFilter()('opportunity')).toBe(true);
  });

  // A single untouchable field does not make the record not worth researching.
  it('should keep an object whose only FORBID entry is field-level', async () => {
    setPolicy({
      default: 'PROPOSE',
      overrides: { 'person.linkedinLink': 'FORBID' },
    });

    await job.handle({ workspaceId: WORKSPACE_ID });

    expect(capturedFilter()('person')).toBe(true);
  });

  it('should read the policy once per tick, not once per candidate', async () => {
    await job.handle({ workspaceId: WORKSPACE_ID });

    capturedFilter()('person');
    capturedFilter()('company');

    expect(aiWritePolicyService.getPolicy).toHaveBeenCalledTimes(1);
  });

  it('should rethrow so the queue records the failure', async () => {
    recordSweepService.sweepWorkspace.mockRejectedValue(new Error('boom'));

    await expect(job.handle({ workspaceId: WORKSPACE_ID })).rejects.toThrow(
      'boom',
    );
  });
});
