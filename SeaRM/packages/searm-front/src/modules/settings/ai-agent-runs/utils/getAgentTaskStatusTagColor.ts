import { type AgentTaskStatus } from '@/settings/ai-agent-runs/types/AgentTask';
import { type TagColor } from 'searm-ui/data-display';

// A run that failed must read differently from one that simply has not run
// yet — red for FAILED, grey for the inert states, green for a real result.
export const getAgentTaskStatusTagColor = (
  status: AgentTaskStatus,
): TagColor => {
  switch (status) {
    case 'FAILED':
      return 'red';
    case 'SUCCEEDED':
      return 'green';
    case 'PENDING':
    case 'LEASED':
      return 'yellow';
    case 'CANCELLED':
      return 'gray';
  }
};
