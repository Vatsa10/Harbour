import { Test, type TestingModule } from '@nestjs/testing';

import { RecordEvidenceTool } from 'src/engine/core-modules/tool/tools/record-evidence-tool/record-evidence-tool';
import { EvidenceRecordingService } from 'src/engine/metadata-modules/ai/ai-research/services/evidence-recording.service';

const context = {
  workspaceId: 'workspace-1',
  threadId: 'thread-1',
} as never;

const validInput = {
  objectNameSingular: 'company',
  recordId: '20202020-1111-4111-8111-111111111111',
  fieldName: 'employees',
  value: 250,
  sourceType: 'WEB_SEARCH',
  sourceLocator: 'https://example.com/about',
  snippet: 'We are a team of 250.',
};

describe('RecordEvidenceTool', () => {
  let tool: RecordEvidenceTool;

  const evidenceRecordingService = { recordEvidence: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    evidenceRecordingService.recordEvidence.mockResolvedValue({
      id: 'evidence-1',
      strength: 'WEAK',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordEvidenceTool,
        {
          provide: EvidenceRecordingService,
          useValue: evidenceRecordingService,
        },
      ],
    }).compile();

    tool = module.get<RecordEvidenceTool>(RecordEvidenceTool);
  });

  it('should persist the observation with its source and field payload', async () => {
    await tool.execute(validInput, context);

    expect(evidenceRecordingService.recordEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        objectNameSingular: 'company',
        recordId: '20202020-1111-4111-8111-111111111111',
        sourceType: 'WEB_SEARCH',
        sourceLocator: 'https://example.com/about',
        payload: {
          fieldName: 'employees',
          value: 250,
          snippet: 'We are a team of 250.',
        },
      }),
    );
  });

  it('should correlate the observation to the run that made it', async () => {
    await tool.execute(validInput, context);

    expect(evidenceRecordingService.recordEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'thread-1' }),
    );
  });

  it('should record evidence outside a run rather than refusing', async () => {
    await tool.execute(validInput, { workspaceId: 'workspace-1' } as never);

    expect(evidenceRecordingService.recordEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ runId: null }),
    );
  });

  it('should stamp the extractor as the tool, not the model', async () => {
    await tool.execute(validInput, context);

    expect(evidenceRecordingService.recordEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ extractor: 'record_evidence' }),
    );
  });

  it('should never let the caller supply the strength', async () => {
    await tool.execute({ ...validInput, strength: 'STRONG' } as never, context);

    const [params] = evidenceRecordingService.recordEvidence.mock.calls[0];

    expect(params).not.toHaveProperty('strength');
  });

  it('should tell the agent the record is unchanged and still needs approval', async () => {
    const result = await tool.execute(validInput, context);

    expect(result.success).toBe(true);
    expect(result.message).toContain('human approval');
  });

  it('should return an actionable failure rather than throwing', async () => {
    evidenceRecordingService.recordEvidence.mockRejectedValue(
      new Error('record not found'),
    );

    const result = await tool.execute(validInput, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('record not found');
    expect(result.error).toContain('fieldName');
  });
});
