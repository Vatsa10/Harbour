import { ModuleRef } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';

import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';

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
  // The real target check: an unknown object or field makes execute() fail,
  // and a missing record returns zero rows.
  const findRecordsService = { execute: jest.fn() };
  const moduleRef = {
    get: jest.fn((token) =>
      token === FindRecordsService ? findRecordsService : undefined,
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    findRecordsService.execute.mockResolvedValue({
      success: true,
      result: { records: [{ id: '20202020-1111-4111-8111-111111111111' }] },
    });
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
        { provide: ModuleRef, useValue: moduleRef },
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

  // The old version of this test asserted only that no `strength` key was on
  // the object literal the tool builds by hand - a property the tool could not
  // have violated. The route the model actually controls is sourceType, which
  // used to map straight to STRONG. What must hold is that everything arriving
  // through this tool is marked MODEL-asserted, whatever source type it claims.
  it('should never let the model promote its own observation, whatever sourceType it claims', async () => {
    for (const sourceType of [
      'CRM_RECORD',
      'CRM_ACTIVITY',
      'MANUAL',
      'WEB_SEARCH',
    ]) {
      await tool.execute(
        { ...validInput, sourceType, strength: 'STRONG' } as never,
        context,
      );
    }

    for (const [params] of evidenceRecordingService.recordEvidence.mock.calls) {
      expect(params).not.toHaveProperty('strength');
      expect(params.assertedBy).toBe('MODEL');
    }
    expect(evidenceRecordingService.recordEvidence).toHaveBeenCalledTimes(4);
  });

  it('should refuse to file evidence against a record that does not exist', async () => {
    findRecordsService.execute.mockResolvedValue({
      success: true,
      result: { records: [] },
    });

    const result = await tool.execute(validInput, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('20202020-1111-4111-8111-111111111111');
    expect(evidenceRecordingService.recordEvidence).not.toHaveBeenCalled();
  });

  it('should refuse to file evidence against an object or field that does not exist', async () => {
    findRecordsService.execute.mockResolvedValue({
      success: false,
      error: 'Object metadata not found',
    });

    const result = await tool.execute(
      { ...validInput, fieldName: 'headcountt' } as never,
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('company.headcountt');
    expect(evidenceRecordingService.recordEvidence).not.toHaveBeenCalled();
  });

  it('should check the target in the workspace the call was made in', async () => {
    await tool.execute(validInput, context);

    expect(findRecordsService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        objectName: 'company',
        select: ['employees'],
        filter: { id: { eq: '20202020-1111-4111-8111-111111111111' } },
      }),
    );
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
