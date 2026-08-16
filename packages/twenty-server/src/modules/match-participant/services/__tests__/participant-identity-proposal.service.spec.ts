import { ModuleRef } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';

import { ProposalCreationService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-creation.service';
import { KeyValuePairService } from 'src/engine/core-modules/key-value-pair/key-value-pair.service';
import { IngestionSuppressionService } from 'src/modules/ingestion-noise-filter/services/ingestion-suppression.service';
import { IdentityResolutionService } from 'src/modules/match-participant/services/identity-resolution.service';
import { ParticipantIdentityProposalService } from 'src/modules/match-participant/services/participant-identity-proposal.service';

describe('ParticipantIdentityProposalService', () => {
  let service: ParticipantIdentityProposalService;

  const identityResolutionService = { resolvePerson: jest.fn() };
  const proposalCreationService = { createFromExtraction: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParticipantIdentityProposalService,
        {
          provide: IdentityResolutionService,
          useValue: identityResolutionService,
        },
        { provide: ProposalCreationService, useValue: proposalCreationService },
        // The real suppression service over an empty tenant list, so the
        // built-in noise layers are exercised rather than mocked away.
        IngestionSuppressionService,
        {
          provide: KeyValuePairService,
          useValue: { get: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: ModuleRef,
          useValue: { get: () => proposalCreationService },
        },
      ],
    }).compile();

    service = module.get<ParticipantIdentityProposalService>(
      ParticipantIdentityProposalService,
    );
    // The real Nest lifecycle runs this; Test.createTestingModule().compile()
    // does not call it without init(), so the seam is wired explicitly.
    service.onModuleInit();
  });

  it('should do nothing when there are no unmatched participants', async () => {
    await service.reviewUnmatchedParticipants({
      participants: [],
      objectMetadataName: 'messageParticipant',
      workspaceId: 'workspace-1',
    });

    expect(identityResolutionService.resolvePerson).not.toHaveBeenCalled();
  });

  it('should skip a participant the inbound noise filter suppresses', async () => {
    await service.reviewUnmatchedParticipants({
      participants: [
        {
          id: 'participant-noise',
          handle: 'noreply@calendar.google.com',
          displayName: 'Google Calendar',
        },
      ],
      objectMetadataName: 'calendarEventParticipant',
      workspaceId: 'workspace-1',
    });

    expect(identityResolutionService.resolvePerson).not.toHaveBeenCalled();
    expect(proposalCreationService.createFromExtraction).not.toHaveBeenCalled();
  });

  it('should skip a participant with no handle', async () => {
    await service.reviewUnmatchedParticipants({
      participants: [
        { id: 'participant-1', handle: null, displayName: 'Jane' },
      ],
      objectMetadataName: 'messageParticipant',
      workspaceId: 'workspace-1',
    });

    expect(identityResolutionService.resolvePerson).not.toHaveBeenCalled();
  });

  it('should propose linking personId when a CANDIDATE match is found', async () => {
    identityResolutionService.resolvePerson.mockResolvedValue({
      kind: 'CANDIDATE',
      recordId: 'person-1',
      explanation: '"Jane Doe" matches an existing person at acme.com',
    });

    await service.reviewUnmatchedParticipants({
      participants: [
        {
          id: 'participant-1',
          handle: 'jane.doe@acme.com',
          displayName: 'Jane Doe',
        },
      ],
      objectMetadataName: 'messageParticipant',
      workspaceId: 'workspace-1',
    });

    expect(proposalCreationService.createFromExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        sourceKey: 'ingestion:messageParticipant:participant-1',
        reason: '"Jane Doe" matches an existing person at acme.com',
        items: [
          expect.objectContaining({
            actionType: 'UPDATE_RECORD',
            objectNameSingular: 'messageParticipant',
            recordId: 'participant-1',
            payload: { personId: 'person-1' },
            baseline: { personId: null },
          }),
        ],
      }),
    );
  });

  it('should not create a proposal for a NONE result', async () => {
    identityResolutionService.resolvePerson.mockResolvedValue({ kind: 'NONE' });

    await service.reviewUnmatchedParticipants({
      participants: [
        { id: 'participant-1', handle: 'nobody@acme.com', displayName: null },
      ],
      objectMetadataName: 'messageParticipant',
      workspaceId: 'workspace-1',
    });

    expect(proposalCreationService.createFromExtraction).not.toHaveBeenCalled();
  });

  it('should not create a proposal for an EXACT result', async () => {
    identityResolutionService.resolvePerson.mockResolvedValue({
      kind: 'EXACT',
      recordId: 'person-1',
      matchedOn: 'email',
    });

    await service.reviewUnmatchedParticipants({
      participants: [
        { id: 'participant-1', handle: 'jane@acme.com', displayName: 'Jane' },
      ],
      objectMetadataName: 'messageParticipant',
      workspaceId: 'workspace-1',
    });

    expect(proposalCreationService.createFromExtraction).not.toHaveBeenCalled();
  });

  // A single participant's failure must not abort the whole sync batch.
  it('should keep reviewing later participants when one throws', async () => {
    identityResolutionService.resolvePerson
      .mockRejectedValueOnce(new Error('lookup exploded'))
      .mockResolvedValueOnce({
        kind: 'CANDIDATE',
        recordId: 'person-2',
        explanation: 'candidate',
      });

    await service.reviewUnmatchedParticipants({
      participants: [
        { id: 'participant-1', handle: 'a@acme.com', displayName: 'A' },
        { id: 'participant-2', handle: 'b@acme.com', displayName: 'B' },
      ],
      objectMetadataName: 'calendarEventParticipant',
      workspaceId: 'workspace-1',
    });

    expect(proposalCreationService.createFromExtraction).toHaveBeenCalledTimes(
      1,
    );
    expect(proposalCreationService.createFromExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKey: 'ingestion:calendarEventParticipant:participant-2',
      }),
    );
  });
});
