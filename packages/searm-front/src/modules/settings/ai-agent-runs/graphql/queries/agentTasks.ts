import { gql } from '@apollo/client';

// Mirrors AgentTaskDTO (agent-task.dto.ts). No agentRuns query exists yet on
// the server, so per-run fields the audit asked to surface — model id,
// elapsed time, transcript, token/credit usage — are not queryable from the
// front today; `outcome` is the one run-derived field the task DTO carries,
// and status alone already tells a failed task apart from one that never ran.
export const AGENT_TASKS = gql`
  query AgentTasks($objectNameSingular: String, $recordId: ID) {
    agentTasks(
      objectNameSingular: $objectNameSingular
      recordId: $recordId
    ) {
      id
      objectNameSingular
      recordId
      agentId
      reason
      priority
      status
      dueAt
      attempts
      maxAttempts
      outcome
      createdAt
    }
  }
`;
