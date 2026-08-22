// The agent's `name` is its only stable handle that crosses the API boundary
// (AgentDTO exposes no universalIdentifier — see
// src/utils/find-agent-id-by-name.util.ts). It is unique per workspace, so the
// workflow seeders resolve the agent's row id through it. Changing this string
// means changing it in the manifest and in every seeded workflow, so it lives
// in exactly one place.
export const SUPPORT_TRIAGE_AGENT_NAME = 'support-triage-agent';
