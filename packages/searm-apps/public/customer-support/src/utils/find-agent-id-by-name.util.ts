import { type MetadataApiClient } from 'searm-client-sdk/metadata';

// An AI_AGENT step's `settings.input.agentId` is read as the agent's row id at
// execution time (ai-agent.workflow-action.ts:
// `agentRepository.findOne(workspaceId, { where: { id: agentId } })`), and that
// id is NOT the manifest universalIdentifier: create-agent-action-handler
// .service.ts assigns `id: action.id ?? v4()`. So it has to be looked up.
//
// SDK GAP (reported, not worked around in core): the natural lookup — by
// universalIdentifier — is not possible over the API. AgentDTO
// (packages/searm-server/src/engine/metadata-modules/ai/ai-agent/dtos/
// agent.dto.ts) exposes no universalIdentifier field, and `findManyAgents`
// takes no filter argument. Name is the only stable, app-authored handle that
// crosses the wire, and it is unique per workspace (enforced by
// validate-agent-name-uniqueness.util.ts), so it is a correct — if
// second-choice — key. Exposing `universalIdentifier` on AgentDTO would make
// this a one-line filtered query; that is a searm-server change and is out of
// this task's boundary.
//
// AgentResolver is @MetadataResolver()-scoped, hence MetadataApiClient here
// while the install mutation uses CoreApiClient.
export const findAgentIdByName = async (
  metadataClient: MetadataApiClient,
  agentName: string,
): Promise<string | undefined> => {
  const { findManyAgents } = await metadataClient.query({
    findManyAgents: {
      id: true,
      name: true,
    },
  });

  return findManyAgents.find((agent) => agent.name === agentName)?.id;
};
