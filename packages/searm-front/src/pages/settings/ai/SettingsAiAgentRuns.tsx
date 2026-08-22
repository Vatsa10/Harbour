import { useQuery } from '@apollo/client/react';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { Fragment, useState } from 'react';
import { SettingsPath } from 'searm-shared/types';
import { getSettingsPath } from 'searm-shared/utils';
import { IconChevronDown, IconChevronRight } from 'searm-ui/icon';
import { Tag } from 'searm-ui/data-display';
import { themeCssVariables } from 'searm-ui/theme-constants';

import { AGENT_RUNS } from '@/settings/ai-agent-runs/graphql/queries/agentRuns';
import { AGENT_TASKS } from '@/settings/ai-agent-runs/graphql/queries/agentTasks';
import { type AgentTask, type AgentTasksData } from '@/settings/ai-agent-runs/types/AgentTask';
import { type AgentRunsData } from '@/settings/ai-agent-runs/types/AgentRun';
import { getAgentTaskStatusTagColor } from '@/settings/ai-agent-runs/utils/getAgentTaskStatusTagColor';
import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { SettingsPageLayout } from '@/settings/components/layout/SettingsPageLayout';

const StyledMessage = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
`;

const StyledTable = styled.div`
  display: grid;
  grid-template-columns: auto minmax(0, 2fr) minmax(0, 1fr) repeat(3, auto) minmax(
      0,
      2fr
    );
  overflow-x: auto;
`;

const StyledExpandButton = styled.button`
  align-items: center;
  background: none;
  border: none;
  color: ${themeCssVariables.font.color.tertiary};
  cursor: pointer;
  display: flex;
  padding: 0;
`;

const StyledRunsPanel = styled.div`
  grid-column: 1 / -1;
`;

const StyledRunsTable = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto minmax(0, 2fr);
  margin: 0 ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[2]};
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

const formatElapsed = (elapsedMs: number | null): string =>
  elapsedMs === null ? '—' : `${(elapsedMs / 1000).toFixed(1)}s`;

const formatCredits = (creditsUsedMicro: number): string =>
  (creditsUsedMicro / 1_000_000).toFixed(4);

const AgentTaskRuns = ({ taskId }: { taskId: string }) => {
  const { data, loading, error } = useQuery<AgentRunsData>(AGENT_RUNS, {
    variables: { agentTaskId: taskId },
  });

  const runs = data?.agentRuns ?? [];

  if (loading) {
    return <StyledMessage>{t`Loading runs…`}</StyledMessage>;
  }

  if (error !== undefined) {
    return <StyledMessage>{t`Could not load runs.`}</StyledMessage>;
  }

  if (runs.length === 0) {
    return <StyledMessage>{t`No runs recorded for this task.`}</StyledMessage>;
  }

  return (
    <StyledRunsTable>
      <StyledHeaderCell>{t`Model`}</StyledHeaderCell>
      <StyledHeaderCell>{t`Elapsed`}</StyledHeaderCell>
      <StyledHeaderCell>{t`Tokens (in/out)`}</StyledHeaderCell>
      <StyledHeaderCell>{t`Credits`}</StyledHeaderCell>
      <StyledHeaderCell>{t`Result / error`}</StyledHeaderCell>
      {runs.map((run) => (
        <Fragment key={run.id}>
          <StyledCell title={run.modelId ?? undefined}>
            {run.modelId ?? '—'}
          </StyledCell>
          <StyledCell>{formatElapsed(run.elapsedMs)}</StyledCell>
          <StyledCell>
            {run.inputTokens}/{run.outputTokens}
          </StyledCell>
          <StyledCell>{formatCredits(run.creditsUsedMicro)}</StyledCell>
          <StyledOutcomeCell>
            {run.errorMessage ?? run.resultSummary ?? '—'}
          </StyledOutcomeCell>
        </Fragment>
      ))}
    </StyledRunsTable>
  );
};

const AgentTaskRow = ({ task }: { task: AgentTask }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <>
      <StyledCell>
        <StyledExpandButton
          type="button"
          onClick={() => setIsExpanded((previous) => !previous)}
          aria-label={isExpanded ? t`Collapse runs` : t`Expand runs`}
        >
          {isExpanded ? <IconChevronDown /> : <IconChevronRight />}
        </StyledExpandButton>
      </StyledCell>
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
      {isExpanded && (
        <StyledRunsPanel>
          <AgentTaskRuns taskId={task.id} />
        </StyledRunsPanel>
      )}
    </>
  );
};

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
            <StyledHeaderCell />
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
