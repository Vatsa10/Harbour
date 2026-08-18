import { useQuery } from '@apollo/client/react';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import { Tag } from 'twenty-ui/data-display';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { AGENT_TASKS } from '@/settings/ai-agent-runs/graphql/queries/agentTasks';
import { type AgentTask, type AgentTasksData } from '@/settings/ai-agent-runs/types/AgentTask';
import { getAgentTaskStatusTagColor } from '@/settings/ai-agent-runs/utils/getAgentTaskStatusTagColor';
import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { SettingsPageLayout } from '@/settings/components/layout/SettingsPageLayout';

const StyledMessage = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
`;

const StyledTable = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) repeat(3, auto) minmax(
      0,
      2fr
    );
  overflow-x: auto;
`;

const StyledHeaderCell = styled.div`
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.medium};
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[2]};
  white-space: nowrap;
`;

const StyledCell = styled.div`
  align-items: center;
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  font-size: ${themeCssVariables.font.size.sm};
  min-width: 0;
  overflow: hidden;
  padding: ${themeCssVariables.spacing[2]};
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledOutcomeCell = styled(StyledCell)`
  color: ${themeCssVariables.font.color.secondary};
  white-space: normal;
`;

const formatDate = (value: string): string => new Date(value).toLocaleString();

// The dueAt/createdAt pair is the closest thing to a queue-latency signal
// this DTO exposes. There is no updatedAt/finishedAt on AgentTaskDTO and no
// agentRuns query at all, so per-run elapsed time, model id, and token/
// credit usage — the audit's other asks — cannot be surfaced without adding
// server GraphQL, which is out of scope for this change (front only).
const AgentTaskRow = ({ task }: { task: AgentTask }) => (
  <>
    <StyledCell title={task.reason}>{task.reason}</StyledCell>
    <StyledCell title={`${task.objectNameSingular} / ${task.recordId}`}>
      {task.objectNameSingular}
    </StyledCell>
    <StyledCell>
      <Tag
        color={getAgentTaskStatusTagColor(task.status)}
        text={task.status}
      />
    </StyledCell>
    <StyledCell>
      {task.attempts}/{task.maxAttempts}
    </StyledCell>
    <StyledCell title={formatDate(task.createdAt)}>
      {formatDate(task.createdAt)}
    </StyledCell>
    <StyledOutcomeCell>{task.outcome ?? t`No outcome recorded yet.`}</StyledOutcomeCell>
  </>
);

export const SettingsAiAgentRuns = () => {
  const { data, loading, error } = useQuery<AgentTasksData>(AGENT_TASKS);

  const tasks = data?.agentTasks ?? [];

  const links = [
    { children: t`Workspace`, href: getSettingsPath(SettingsPath.General) },
    { children: t`AI agent runs` },
  ];

  if (loading) {
    return (
      <SettingsPageLayout title={t`AI agent runs`} links={links}>
        <SettingsPageContainer>
          <StyledMessage>{t`Loading…`}</StyledMessage>
        </SettingsPageContainer>
      </SettingsPageLayout>
    );
  }

  if (error !== undefined) {
    return (
      <SettingsPageLayout title={t`AI agent runs`} links={links}>
        <SettingsPageContainer>
          <StyledMessage>{t`Could not load agent tasks.`}</StyledMessage>
        </SettingsPageContainer>
      </SettingsPageLayout>
    );
  }

  return (
    <SettingsPageLayout title={t`AI agent runs`} links={links}>
      <SettingsPageContainer>
        {tasks.length === 0 ? (
          <StyledMessage>{t`No agent tasks have been scheduled yet.`}</StyledMessage>
        ) : (
          <StyledTable>
            <StyledHeaderCell>{t`Reason`}</StyledHeaderCell>
            <StyledHeaderCell>{t`Object`}</StyledHeaderCell>
            <StyledHeaderCell>{t`Status`}</StyledHeaderCell>
            <StyledHeaderCell>{t`Attempts`}</StyledHeaderCell>
            <StyledHeaderCell>{t`Created`}</StyledHeaderCell>
            <StyledHeaderCell>{t`Outcome / failure reason`}</StyledHeaderCell>
            {tasks.map((task) => (
              <AgentTaskRow key={task.id} task={task} />
            ))}
          </StyledTable>
        )}
      </SettingsPageContainer>
    </SettingsPageLayout>
  );
};
