import { Injectable, Logger } from '@nestjs/common';

import { generateText } from 'ai';
import { FieldActorSource, MessageParticipantRole } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { AI_TELEMETRY_CONFIG } from 'src/engine/metadata-modules/ai/ai-models/constants/ai-telemetry.const';
import { AiModelRegistryService } from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service';
import { EvidenceRecordingService } from 'src/engine/metadata-modules/ai/ai-research/services/evidence-recording.service';
import { type EvidenceSourceType } from 'src/engine/metadata-modules/ai/ai-research/types/evidence.type';
import { ProposalCreationService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-creation.service';
import { ProposalActionType } from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type CalendarEventParticipantWorkspaceEntity } from 'src/modules/calendar/common/standard-objects/calendar-event-participant.workspace-entity';
import { type CalendarEventWorkspaceEntity } from 'src/modules/calendar/common/standard-objects/calendar-event.workspace-entity';
import { type MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { type MessageWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message.workspace-entity';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { AiExtractionExclusionService } from 'src/modules/structured-extraction/services/ai-extraction-exclusion.service';
import {
  EXTRACTABLE_PERSON_FIELDS,
  type ExtractablePersonField,
  type ExtractionClaim,
  type ExtractionRequest,
  type ExtractionResult,
  type ExtractionSourceKind,
} from 'src/modules/structured-extraction/types/structured-extraction.type';

const EXTRACTOR_NAME = 'structured-extraction/v1';

// Long bodies are truncated rather than rejected: the useful signal in an
// email is overwhelmingly near the top, and an unbounded body is an unbounded
// token bill on a path that runs per ingested message.
const MAX_CONTENT_CHARACTERS = 8000;

const SOURCE_EVIDENCE_TYPE: Record<ExtractionSourceKind, EvidenceSourceType> = {
  MESSAGE: 'EMAIL_MESSAGE',
  CALENDAR_EVENT: 'CALL_RECORDING',
};

type ExtractionSubject = {
  personId: string;
  content: string;
  observedAt: Date;
};

/**
 * Phase 3 Task 4.
 *
 * Reads ingested email and calendar content and turns what it finds into
 * *proposals*, never records. Three properties matter more than the
 * extraction quality:
 *
 * 1. Nothing here writes a CRM record. Every candidate change goes through
 *    ProposalCreationService, which is the same table and the same policy
 *    lookup the agent gate uses — so a workspace FORBID suppresses ingestion
 *    proposals exactly as it suppresses agent writes.
 * 2. Every claim becomes evidence before it becomes anything else, so a
 *    proposal row cites the message it came from and the sentence it read.
 * 3. The owner exclusion is re-checked here even though the enqueue boundary
 *    already checked it. The enqueue check is what keeps excluded content out
 *    of a job payload; this one covers the window between enqueue and run.
 */
@Injectable()
export class StructuredExtractionService {
  private readonly logger = new Logger(StructuredExtractionService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly aiExtractionExclusionService: AiExtractionExclusionService,
    private readonly evidenceRecordingService: EvidenceRecordingService,
    private readonly proposalCreationService: ProposalCreationService,
    private readonly aiModelRegistryService: AiModelRegistryService,
  ) {}

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    const { workspaceId, sourceKind, sourceId } = request;

    if (await this.isExcluded(request)) {
      return { status: 'EXCLUDED', proposalId: null, claimCount: 0 };
    }

    const subject =
      sourceKind === 'MESSAGE'
        ? await this.loadMessageSubject(workspaceId, sourceId)
        : await this.loadCalendarEventSubject(workspaceId, sourceId);

    if (!isDefined(subject)) {
      return { status: 'NO_SUBJECT', proposalId: null, claimCount: 0 };
    }

    if (subject.content.trim() === '') {
      return { status: 'NO_CONTENT', proposalId: null, claimCount: 0 };
    }

    const current = await this.loadPersonFields(workspaceId, subject.personId);

    if (!isDefined(current)) {
      return { status: 'NO_SUBJECT', proposalId: null, claimCount: 0 };
    }

    const claims = await this.askModelForClaims(subject.content);

    if (!isDefined(claims)) {
      return { status: 'NO_MODEL', proposalId: null, claimCount: 0 };
    }

    // A claim that restates what the record already says is not a change and
    // must never reach a human's review queue.
    const changes = claims.filter(
      (claim) => claim.value !== (current[claim.fieldName] ?? null),
    );

    if (changes.length === 0) {
      return { status: 'NO_CLAIMS', proposalId: null, claimCount: 0 };
    }

    const sourceLocator = `${sourceKind === 'MESSAGE' ? 'message' : 'calendarEvent'}:${sourceId}`;

    for (const claim of changes) {
      await this.evidenceRecordingService.recordEvidence({
        workspaceId,
        // No agent run behind ingestion; the sourceLocator is what a reviewer
        // follows back instead.
        runId: null,
        objectNameSingular: 'person',
        recordId: subject.personId,
        sourceType: SOURCE_EVIDENCE_TYPE[sourceKind],
        sourceLocator,
        extractor: EXTRACTOR_NAME,
        observedAt: subject.observedAt,
        payload: {
          fieldName: claim.fieldName,
          value: claim.value,
          snippet: claim.snippet,
        },
      });
    }

    const proposal = await this.proposalCreationService.createFromExtraction({
      workspaceId,
      // Keyed on the source, so a job retried after a crash re-proposes
      // nothing. Idempotency is a contract requirement, not an optimisation.
      sourceKey: `extraction:${sourceLocator}`,
      reason: `Extracted from ${sourceKind === 'MESSAGE' ? 'an email message' : 'a calendar event'} (${sourceLocator})`,
      createdByActor: {
        source:
          sourceKind === 'MESSAGE'
            ? FieldActorSource.EMAIL
            : FieldActorSource.CALENDAR,
        workspaceMemberId: null,
        name: 'Structured extraction',
        context: {},
      },
      // One item per field, not one item carrying every field: the write
      // policy resolves per field, so a FORBID on person.jobTitle must
      // suppress that field alone rather than the whole batch.
      items: changes.map((claim) => ({
        actionType: ProposalActionType.UPDATE_RECORD,
        objectNameSingular: 'person',
        recordId: subject.personId,
        payload: { [claim.fieldName]: claim.value },
        baseline: { [claim.fieldName]: current[claim.fieldName] ?? null },
      })),
    });

    if (!isDefined(proposal)) {
      // Suppressed by policy, or already proposed. Either way nothing new is
      // reviewable, and the evidence stays on file regardless.
      return { status: 'NO_CLAIMS', proposalId: null, claimCount: changes.length };
    }

    return {
      status: 'PROPOSED',
      proposalId: proposal.proposalId,
      claimCount: changes.length,
    };
  }

  private async isExcluded(request: ExtractionRequest): Promise<boolean> {
    const { workspaceId, sourceKind, sourceId } = request;

    return sourceKind === 'MESSAGE'
      ? this.aiExtractionExclusionService.isMessageExcluded({
          workspaceId,
          messageId: sourceId,
        })
      : this.aiExtractionExclusionService.isCalendarEventExcluded({
          workspaceId,
          calendarEventId: sourceId,
        });
  }

  private async loadMessageSubject(
    workspaceId: string,
    messageId: string,
  ): Promise<ExtractionSubject | null> {
    const messageRepository =
      await this.globalWorkspaceOrmManager.getRepository<MessageWorkspaceEntity>(
        workspaceId,
        'message',
        { shouldBypassPermissionChecks: true },
      );

    const message = await messageRepository.findOne({
      where: { id: messageId },
    });

    if (!isDefined(message)) {
      return null;
    }

    const participantRepository =
      await this.globalWorkspaceOrmManager.getRepository<MessageParticipantWorkspaceEntity>(
        workspaceId,
        'messageParticipant',
        { shouldBypassPermissionChecks: true },
      );

    const participants = await participantRepository.find({
      where: { messageId },
    });

    // The sender is the subject: a claim like "I moved to Head of Sales" is
    // about whoever wrote it, and attributing it to a recipient would write
    // one person's job title onto another's record.
    const sender = participants.find(
      (participant) =>
        participant.role === MessageParticipantRole.FROM &&
        isDefined(participant.personId),
    );

    if (!isDefined(sender?.personId)) {
      return null;
    }

    return {
      personId: sender.personId,
      content: [message.subject, message.text].filter(isDefined).join('\n\n'),
      observedAt: message.receivedAt ?? new Date(),
    };
  }

  private async loadCalendarEventSubject(
    workspaceId: string,
    calendarEventId: string,
  ): Promise<ExtractionSubject | null> {
    const eventRepository =
      await this.globalWorkspaceOrmManager.getRepository<CalendarEventWorkspaceEntity>(
        workspaceId,
        'calendarEvent',
        { shouldBypassPermissionChecks: true },
      );

    const event = await eventRepository.findOne({
      where: { id: calendarEventId },
    });

    if (!isDefined(event)) {
      return null;
    }

    const participantRepository =
      await this.globalWorkspaceOrmManager.getRepository<CalendarEventParticipantWorkspaceEntity>(
        workspaceId,
        'calendarEventParticipant',
        { shouldBypassPermissionChecks: true },
      );

    const participants = await participantRepository.find({
      where: { calendarEventId },
    });

    // The organiser wrote the description, so the same attribution rule as
    // the message sender applies.
    const organizer = participants.find(
      (participant) => participant.isOrganizer && isDefined(participant.personId),
    );

    if (!isDefined(organizer?.personId)) {
      return null;
    }

    return {
      personId: organizer.personId,
      content: [event.title, event.description].filter(isDefined).join('\n\n'),
      observedAt: isDefined(event.startsAt)
        ? new Date(event.startsAt)
        : new Date(),
    };
  }

  private async loadPersonFields(
    workspaceId: string,
    personId: string,
  ): Promise<Record<ExtractablePersonField, string | null> | null> {
    const personRepository =
      await this.globalWorkspaceOrmManager.getRepository<PersonWorkspaceEntity>(
        workspaceId,
        'person',
        { shouldBypassPermissionChecks: true },
      );

    const person = await personRepository.findOne({ where: { id: personId } });

    if (!isDefined(person)) {
      return null;
    }

    return Object.fromEntries(
      EXTRACTABLE_PERSON_FIELDS.map((fieldName) => [
        fieldName,
        (person as unknown as Record<string, unknown>)[fieldName] ?? null,
      ]),
    ) as Record<ExtractablePersonField, string | null>;
  }

  // Returns null when no model is configured — distinct from an empty claim
  // list, because "we could not look" and "we looked and found nothing" must
  // not read the same in the job log.
  private async askModelForClaims(
    content: string,
  ): Promise<ExtractionClaim[] | null> {
    const model = this.aiModelRegistryService.getDefaultSpeedModel();

    if (!isDefined(model)) {
      this.logger.warn(
        'No default AI model is configured; skipping structured extraction.',
      );

      return null;
    }

    const truncated = content.slice(0, MAX_CONTENT_CHARACTERS);

    const prompt = `You are extracting CRM facts about the AUTHOR of the following content.

Only report a field when the content states it about the author explicitly. Never infer, never guess, never use outside knowledge. If nothing is stated, return an empty list.

Allowed fields: ${EXTRACTABLE_PERSON_FIELDS.join(', ')}.

For each field you report, include the exact verbatim sentence from the content that states it.

Respond ONLY with valid JSON of the form:
{"claims": [{"fieldName": "<field>", "value": "<string>", "snippet": "<verbatim sentence>"}]}

CONTENT:
${truncated}`;

    try {
      const result = await generateText({
        model: model.model,
        prompt,
        temperature: 0,
        experimental_telemetry: AI_TELEMETRY_CONFIG,
      });

      return this.parseClaims(result.text, truncated);
    } catch (error) {
      this.logger.error(
        `Structured extraction model call failed: ${error instanceof Error ? error.message : error}`,
      );

      return null;
    }
  }

  // Anything malformed is dropped, not repaired. A half-understood claim
  // becomes a fact a human is asked to trust, so the bar is "parsed cleanly
  // and matches the allowlist" or nothing.
  private parseClaims(text: string, content: string): ExtractionClaim[] {
    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch {
      this.logger.warn('Structured extraction returned unparseable JSON.');

      return [];
    }

    const rawClaims = (parsed as { claims?: unknown })?.claims;

    if (!Array.isArray(rawClaims)) {
      return [];
    }

    return rawClaims.flatMap((raw) => {
      const candidate = raw as Partial<ExtractionClaim>;

      const isAllowedField = EXTRACTABLE_PERSON_FIELDS.includes(
        candidate.fieldName as ExtractablePersonField,
      );

      if (
        !isAllowedField ||
        typeof candidate.value !== 'string' ||
        candidate.value.trim() === '' ||
        typeof candidate.snippet !== 'string'
      ) {
        return [];
      }

      // A snippet the model composed rather than quoted is a fabricated
      // citation, which is worse than no citation: it makes an unsupported
      // claim look sourced. Drop the whole claim.
      if (!content.includes(candidate.snippet)) {
        this.logger.warn(
          `Dropping ${candidate.fieldName} claim: its snippet is not present in the source content.`,
        );

        return [];
      }

      return [
        {
          fieldName: candidate.fieldName as ExtractablePersonField,
          value: candidate.value.trim(),
          snippet: candidate.snippet,
        },
      ];
    });
  }
}
