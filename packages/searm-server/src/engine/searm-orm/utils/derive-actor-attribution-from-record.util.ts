import { FieldActorSource, type ActorMetadata } from 'searm-shared/types';
import { isDefined } from 'searm-shared/utils';

// A record's `createdBy`/`updatedBy` actor-composite field is populated by
// record-crud with the true principal of the write (AGENT, WORKFLOW, API,
// IMPORT, MANUAL, ...), but nothing previously carried that forward onto the
// emitted database event's properties. EventLogRegistry.deriveActorAttribution
// reads `properties.actorKind` / `properties.proposalId` off the event, so
// without this the actor trail always fell back to "user"/"system" and an
// AI-originated write was indistinguishable from a hand-typed one.
export const deriveActorAttributionFromRecord = (
  record: Record<string, unknown> | undefined,
): { actorKind?: string; proposalId?: string } => {
  const actor = record?.updatedBy ?? record?.createdBy;

  if (!isDefined(actor) || typeof actor !== 'object') {
    return {};
  }

  const actorMetadata = actor as Partial<ActorMetadata>;

  if (!isDefined(actorMetadata.source)) {
    return {};
  }

  const proposalId =
    typeof actorMetadata.context?.proposalId === 'string'
      ? actorMetadata.context.proposalId
      : undefined;

  return {
    actorKind:
      actorMetadata.source === FieldActorSource.MANUAL
        ? 'user'
        : actorMetadata.source.toLowerCase(),
    ...(isDefined(proposalId) && { proposalId }),
  };
};
