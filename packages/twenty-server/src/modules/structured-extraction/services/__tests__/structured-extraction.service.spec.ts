import { Test, type TestingModule } from '@nestjs/testing';

import { generateText } from 'ai';

import { AiModelRegistryService } from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service';
import { IngestionSuppressionService } from 'src/modules/ingestion-noise-filter/services/ingestion-suppression.service';
import { EvidenceRecordingService } from 'src/engine/metadata-modules/ai/ai-research/services/evidence-recording.service';
import { ProposalCreationService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-creation.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { AiExtractionExclusionService } from 'src/modules/structured-extraction/services/ai-extraction-exclusion.service';
import { StructuredExtractionService } from 'src/modules/structured-extraction/services/structured-extraction.service';

jest.mock('ai', () => ({ generateText: jest.fn() }));

const generateTextMock = generateText as unknown as jest.Mock;

const BODY = 'Quick note. I am now Head of Sales at Acme. Talk soon.';
const SNIPPET = 'I am now Head of Sales at Acme.';

describe('StructuredExtractionService', () => {
  let service: StructuredExtractionService;

  const exclusionService = {
    isMessageExcluded: jest.fn(),
    isCalendarEventExcluded: jest.fn(),
  };
  const evidenceRecordingService = { recordEvidence: jest.fn() };
  const proposalCreationService = { createFromExtraction: jest.fn() };
  const aiModelRegistryService = { getDefaultSpeedModel: jest.fn() };

  const repositories: Record<string, { find: jest.Mock; findOne: jest.Mock }> =
    {};

  const globalWorkspaceOrmManager = {
    getRepository: jest.fn(async (_workspaceId: string, objectName: string) => {
      repositories[objectName] ??= { find: jest.fn(), findOne: jest.fn() };

      return repositories[objectName];
    }),
  };

  const seedMessageWorld = () => {
    repositories.message = {
      find: jest.fn(),
      findOne: jest.fn().mockResolvedValue({
        id: 'message-1',
        subject: 'Update',
        text: BODY,
        receivedAt: new Date('2026-01-02T00:00:00.000Z'),
      }),
    };
    repositories.messageParticipant = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([
        { id: 'p-1', role: 'TO', personId: 'person-other' },
        { id: 'p-2', role: 'FROM', personId: 'person-1' },
      ]),
    };
    repositories.person = {
      find: jest.fn(),
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'person-1', jobTitle: 'Sales Rep' }),
    };
  };

  const extractMessage = () =>
    service.extract({
      workspaceId: 'workspace-1',
      sourceKind: 'MESSAGE',
      sourceId: 'message-1',
    });

  beforeEach(async () => {
    jest.clearAllMocks();

    for (const key of Object.keys(repositories)) {
      delete repositories[key];
    }

    exclusionService.isMessageExcluded.mockResolvedValue(false);
    exclusionService.isCalendarEventExcluded.mockResolvedValue(false);
    aiModelRegistryService.getDefaultSpeedModel.mockReturnValue({
      model: 'fake-model',
    });
    proposalCreationService.createFromExtraction.mockResolvedValue({
      proposalId: 'proposal-1',
      itemIds: ['item-1'],
    });
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        claims: [
          { fieldName: 'jobTitle', value: 'Head of Sales', snippet: SNIPPET },
        ],
      }),
    });

    seedMessageWorld();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StructuredExtractionService,
        {
          provide: GlobalWorkspaceOrmManager,
          useValue: globalWorkspaceOrmManager,
        },
        { provide: AiExtractionExclusionService, useValue: exclusionService },
        {
          provide: EvidenceRecordingService,
          useValue: evidenceRecordingService,
        },
        { provide: ProposalCreationService, useValue: proposalCreationService },
        { provide: AiModelRegistryService, useValue: aiModelRegistryService },
        {
          provide: IngestionSuppressionService,
          useValue: {
            buildFilter: jest
              .fn()
              .mockResolvedValue({ isSuppressed: () => false }),
          },
        },
      ],
    }).compile();

    service = module.get(StructuredExtractionService);
  });

  it('should propose the extracted change against the message sender', async () => {
    const result = await extractMessage();

    expect(result).toEqual({
      status: 'PROPOSED',
      proposalId: 'proposal-1',
      claimCount: 1,
    });
    expect(proposalCreationService.createFromExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        sourceKey: 'extraction:message:message-1',
        items: [
          {
            actionType: 'UPDATE_RECORD',
            objectNameSingular: 'person',
            // The sender, not the recipient: attributing the claim to
            // person-other would write one person's title onto another.
            recordId: 'person-1',
            payload: { jobTitle: 'Head of Sales' },
            baseline: { jobTitle: 'Sales Rep' },
          },
        ],
      }),
    );
  });

  it('should record evidence citing the source before proposing anything', async () => {
    await extractMessage();

    expect(evidenceRecordingService.recordEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        objectNameSingular: 'person',
        recordId: 'person-1',
        sourceType: 'EMAIL_MESSAGE',
        sourceLocator: 'message:message-1',
        payload: {
          fieldName: 'jobTitle',
          value: 'Head of Sales',
          snippet: SNIPPET,
        },
      }),
    );

    const evidenceOrder =
      evidenceRecordingService.recordEvidence.mock.invocationCallOrder[0];
    const proposalOrder =
      proposalCreationService.createFromExtraction.mock.invocationCallOrder[0];

    expect(evidenceOrder).toBeLessThan(proposalOrder);
  });

  it('should never write a record directly', async () => {
    // The repository doubles expose find/findOne and nothing else, so any
    // repository.save/update/insert the service attempted would throw here
    // rather than pass silently. The outcome must be a proposal instead.
    await expect(extractMessage()).resolves.toEqual(
      expect.objectContaining({ status: 'PROPOSED' }),
    );

    expect(proposalCreationService.createFromExtraction).toHaveBeenCalledTimes(
      1,
    );
  });

  it('should not read content at all when the account is excluded', async () => {
    exclusionService.isMessageExcluded.mockResolvedValue(true);

    const result = await extractMessage();

    expect(result.status).toBe('EXCLUDED');
    expect(globalWorkspaceOrmManager.getRepository).not.toHaveBeenCalled();
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it('should report policy suppression rather than a proposal', async () => {
    proposalCreationService.createFromExtraction.mockResolvedValue(null);

    const result = await extractMessage();

    expect(result.proposalId).toBeNull();
    expect(result.status).toBe('NO_CLAIMS');
  });

  it('should drop a claim whose snippet is not verbatim in the source', async () => {
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        claims: [
          {
            fieldName: 'jobTitle',
            value: 'Chief Executive Officer',
            snippet: 'I was promoted to CEO last week.',
          },
        ],
      }),
    });

    const result = await extractMessage();

    expect(result.status).toBe('NO_CLAIMS');
    expect(evidenceRecordingService.recordEvidence).not.toHaveBeenCalled();
    expect(proposalCreationService.createFromExtraction).not.toHaveBeenCalled();
  });

  it('should drop a claim for a field outside the allowlist', async () => {
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        claims: [
          { fieldName: 'salary', value: '250000', snippet: SNIPPET },
          { fieldName: 'jobTitle', value: 'Head of Sales', snippet: SNIPPET },
        ],
      }),
    });

    await extractMessage();

    const [call] = proposalCreationService.createFromExtraction.mock.calls;

    expect(call[0].items).toHaveLength(1);
    expect(call[0].items[0].payload).toEqual({ jobTitle: 'Head of Sales' });
  });

  it('should propose nothing when the claim restates the current value', async () => {
    repositories.person.findOne.mockResolvedValue({
      id: 'person-1',
      jobTitle: 'Head of Sales',
    });

    const result = await extractMessage();

    expect(result.status).toBe('NO_CLAIMS');
    expect(proposalCreationService.createFromExtraction).not.toHaveBeenCalled();
  });

  it('should propose nothing when the sender is not linked to a person', async () => {
    repositories.messageParticipant.find.mockResolvedValue([
      { id: 'p-2', role: 'FROM', personId: null },
    ]);

    const result = await extractMessage();

    expect(result.status).toBe('NO_SUBJECT');
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it('should distinguish "no model configured" from "found nothing"', async () => {
    aiModelRegistryService.getDefaultSpeedModel.mockReturnValue(undefined);

    const result = await extractMessage();

    expect(result.status).toBe('NO_MODEL');
    expect(proposalCreationService.createFromExtraction).not.toHaveBeenCalled();
  });

  it('should drop unparseable model output rather than guessing', async () => {
    generateTextMock.mockResolvedValue({ text: 'Sure! Here you go:' });

    const result = await extractMessage();

    expect(result.status).toBe('NO_CLAIMS');
    expect(proposalCreationService.createFromExtraction).not.toHaveBeenCalled();
  });

  it('should extract a calendar event against its organiser', async () => {
    repositories.calendarEvent = {
      find: jest.fn(),
      findOne: jest.fn().mockResolvedValue({
        id: 'event-1',
        title: 'Sync',
        description: BODY,
        startsAt: '2026-01-02T00:00:00.000Z',
      }),
    };
    repositories.calendarEventParticipant = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([
        { id: 'c-1', isOrganizer: false, personId: 'person-other' },
        { id: 'c-2', isOrganizer: true, personId: 'person-1' },
      ]),
    };

    const result = await service.extract({
      workspaceId: 'workspace-1',
      sourceKind: 'CALENDAR_EVENT',
      sourceId: 'event-1',
    });

    expect(result.status).toBe('PROPOSED');
    expect(evidenceRecordingService.recordEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'CALL_RECORDING',
        sourceLocator: 'calendarEvent:event-1',
        recordId: 'person-1',
      }),
    );
    expect(
      proposalCreationService.createFromExtraction.mock.calls[0][0].sourceKey,
    ).toBe('extraction:calendarEvent:event-1');
  });
});
