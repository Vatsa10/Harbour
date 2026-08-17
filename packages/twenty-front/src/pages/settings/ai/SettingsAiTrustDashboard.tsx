import { useQuery } from '@apollo/client/react';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { GraphWidgetBarChart } from '@/page-layout/widgets/graph/graph-widget-bar-chart/components/GraphWidgetBarChart';
import { AiTrustChartFrame } from '@/settings/ai-dashboard/components/AiTrustChartFrame';
import { AI_TRUST_DASHBOARD } from '@/settings/ai-dashboard/graphql/queries/aiTrustDashboard';
import { type AiTrustDashboardData } from '@/settings/ai-dashboard/types/AiTrustDashboard';
import {
  buildCountBarChartData,
  buildSpendBarChartData,
  computeApprovalRate,
  sumCounts,
  sumCredits,
  sumTokens,
} from '@/settings/ai-dashboard/utils/buildAiTrustChartData';
import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { SettingsPageLayout } from '@/settings/components/layout/SettingsPageLayout';
import { BarChartLayout } from '~/generated-metadata/graphql';

const StyledTileRow = styled.div`
  display: grid;
  gap: ${themeCssVariables.spacing[3]};
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
`;

const StyledTile = styled.div`
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  padding: ${themeCssVariables.spacing[3]};
`;

const StyledTileValue = styled.div`
  font-size: ${themeCssVariables.font.size.xl};
  font-weight: ${themeCssVariables.font.weight.semiBold};
`;

const StyledTileLabel = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledChartGrid = styled.div`
  display: grid;
  gap: ${themeCssVariables.spacing[4]};
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  padding-top: ${themeCssVariables.spacing[4]};
`;

const StyledMessage = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
`;

const formatNumber = (value: number): string =>
  new Intl.NumberFormat().format(Math.round(value));

export const SettingsAiTrustDashboard = () => {
  const { data, loading, error } = useQuery<AiTrustDashboardData>(
    AI_TRUST_DASHBOARD,
    { variables: { period: 'DAY', bucketCount: 30 } },
  );

  const dashboard = data?.findAiTrustDashboard;

  const links = [
    { children: t`Workspace`, href: getSettingsPath(SettingsPath.General) },
    { children: t`AI evidence & cost` },
  ];

  if (loading) {
    return (
      <SettingsPageLayout title={t`AI evidence & cost`} links={links}>
        <SettingsPageContainer>
          <StyledMessage>{t`Loading…`}</StyledMessage>
        </SettingsPageContainer>
      </SettingsPageLayout>
    );
  }

  // An errored query and an empty workspace must not render the same. Zeroes
  // drawn from a failed request are a fabricated claim about the data.
  if (error !== undefined || dashboard === undefined) {
    return (
      <SettingsPageLayout title={t`AI evidence & cost`} links={links}>
        <SettingsPageContainer>
          <StyledMessage>
            {t`Could not load the dashboard. Nothing below is a measurement.`}
          </StyledMessage>
        </SettingsPageContainer>
      </SettingsPageLayout>
    );
  }

  const approvalRate = computeApprovalRate(dashboard.proposalItemOutcomes);

  const hasAnyFacts = dashboard.currentFactCount > 0;
  const hasAnyOutcomes = sumCounts(dashboard.proposalItemOutcomes) > 0;
  const hasAnySpend = dashboard.spendByPeriod.length > 0;

  return (
    <SettingsPageLayout title={t`AI evidence & cost`} links={links}>
      <SettingsPageContainer>
        <StyledTileRow>
          <StyledTile>
            <StyledTileValue>
              {formatNumber(dashboard.currentFactCount)}
            </StyledTileValue>
            <StyledTileLabel>{t`Facts believed`}</StyledTileLabel>
          </StyledTile>
          <StyledTile>
            <StyledTileValue>
              {formatNumber(dashboard.conflictedFactCount)}
            </StyledTileValue>
            <StyledTileLabel>{t`In conflict`}</StyledTileLabel>
          </StyledTile>
          <StyledTile>
            <StyledTileValue>
              {approvalRate === null
                ? '—'
                : `${Math.round(approvalRate * 100)}%`}
            </StyledTileValue>
            <StyledTileLabel>{t`Approved of reviewed`}</StyledTileLabel>
          </StyledTile>
          <StyledTile>
            <StyledTileValue>
              {sumCredits(dashboard.spendByPeriod).toFixed(2)}
            </StyledTileValue>
            <StyledTileLabel>{t`Credits, last 30 days`}</StyledTileLabel>
          </StyledTile>
          <StyledTile>
            <StyledTileValue>
              {formatNumber(sumTokens(dashboard.spendByPeriod))}
            </StyledTileValue>
            <StyledTileLabel>{t`Tokens, last 30 days`}</StyledTileLabel>
          </StyledTile>
        </StyledTileRow>

        <StyledChartGrid>
          <AiTrustChartFrame
            title={t`Where the AI learned it`}
            caption={t`Current facts by the source type of the evidence behind them.`}
            instanceId="ai-trust-source-type"
          >
            {hasAnyFacts ? (
              <GraphWidgetBarChart
                id="ai-trust-source-type"
                data={buildCountBarChartData(
                  dashboard.factsBySourceType,
                  'facts',
                )}
                indexBy="category"
                keys={['facts']}
                colorMode="automaticPalette"
                layout={BarChartLayout.HORIZONTAL}
                showGrid
                showLegend={false}
              />
            ) : (
              <StyledMessage>{t`No facts recorded yet.`}</StyledMessage>
            )}
          </AiTrustChartFrame>

          <AiTrustChartFrame
            title={t`How fresh it is`}
            caption={t`Current facts by when the world was last observed, not when the row was written.`}
            instanceId="ai-trust-freshness"
          >
            {hasAnyFacts ? (
              <GraphWidgetBarChart
                id="ai-trust-freshness"
                data={buildCountBarChartData(dashboard.factFreshness, 'facts')}
                indexBy="category"
                keys={['facts']}
                colorMode="automaticPalette"
                showGrid
                showLegend={false}
              />
            ) : (
              <StyledMessage>{t`No facts recorded yet.`}</StyledMessage>
            )}
          </AiTrustChartFrame>

          <AiTrustChartFrame
            title={t`What humans decided`}
            caption={t`Proposed changes by outcome, counted per item rather than per batch.`}
            instanceId="ai-trust-outcomes"
          >
            {hasAnyOutcomes ? (
              <GraphWidgetBarChart
                id="ai-trust-outcomes"
                data={buildCountBarChartData(
                  dashboard.proposalItemOutcomes,
                  'items',
                )}
                indexBy="category"
                keys={['items']}
                colorMode="automaticPalette"
                layout={BarChartLayout.HORIZONTAL}
                showGrid
                showLegend={false}
              />
            ) : (
              <StyledMessage>{t`Nothing has been proposed yet.`}</StyledMessage>
            )}
          </AiTrustChartFrame>

          <AiTrustChartFrame
            title={t`What it cost`}
            caption={t`Credits consumed by agent runs per day. Days with no runs are omitted.`}
            instanceId="ai-trust-spend"
          >
            {hasAnySpend ? (
              <GraphWidgetBarChart
                id="ai-trust-spend"
                data={buildSpendBarChartData(dashboard.spendByPeriod)}
                indexBy="period"
                keys={['credits']}
                colorMode="automaticPalette"
                showGrid
                showLegend={false}
              />
            ) : (
              <StyledMessage>{t`No agent runs in this period.`}</StyledMessage>
            )}
          </AiTrustChartFrame>
        </StyledChartGrid>
      </SettingsPageContainer>
    </SettingsPageLayout>
  );
};
