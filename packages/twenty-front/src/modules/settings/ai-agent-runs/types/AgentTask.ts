export type AgentTaskStatus =
  | 'PENDING'
  | 'LEASED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

export type AgentTask = {
  id: string;
  objectNameSingular: string;
  recordId: string;
  agentId: string;
  reason: string;
  priority: number;
  status: AgentTaskStatus;
  dueAt: string;
  attempts: number;
  maxAttempts: number;
  outcome: string | null;
  createdAt: string;
};

export type AgentTasksData = {
  agentTasks: AgentTask[];
};
