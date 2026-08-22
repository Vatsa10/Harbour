import { useMutation, useQuery } from '@apollo/client/react';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { themeCssVariables } from 'searm-ui/theme-constants';

import { ProposalDiffTable } from '@/settings/ai-approvals/components/ProposalDiffTable';
import {
  APPROVE_PROPOSAL,
  REJECT_PROPOSAL,
} from '@/settings/ai-approvals/graphql/mutations/approveProposal';
import { PENDING_PROPOSALS } from '@/settings/ai-approvals/graphql/queries/pendingProposals';
import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { SettingsPageLayout } from '@/settings/components/layout/SettingsPageLayout';
import { SettingsPath } from 'searm-shared/types';
import { getSettingsPath } from 'searm-shared/utils';

const StyledProposal = styled.section`
  padding-bottom: ${themeCssVariables.spacing[6]};
`;

const StyledHeading = styled.h2`
  font-size: ${themeCssVariables.font.size.md};
  font-weight: ${themeCssVariables.font.weight.medium};
`;

type Proposal = {
  id: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  items: Array<{
    id: string;
    actionType: string;
    objectNameSingular: string | null;
    recordId: string | null;
    toolId: string | null;
    payload: Record<string, unknown>;
    baseline: Record<string, unknown>;
    status: string;
    error: string | null;
  }>;
};

type PendingProposalsData = {
  pendingProposals: Proposal[];
};

export const SettingsAiApprovals = () => {
  const { data, loading, refetch } =
    useQuery<PendingProposalsData>(PENDING_PROPOSALS);
  const [approveProposal] = useMutation(APPROVE_PROPOSAL);
  const [rejectProposal] = useMutation(REJECT_PROPOSAL);

  const proposals = data?.pendingProposals ?? [];

  const handleApprove = async (
    proposalId: string,
    selectedItemIds: string[],
  ) => {
    await approveProposal({
      variables: { input: { proposalId, selectedItemIds } },
    });
    await refetch();
  };

  const handleReject = async (proposalId: string) => {
    await rejectProposal({ variables: { input: { proposalId } } });
    await refetch();
  };

  if (loading) {
    return (
      <SettingsPageLayout
        title={t`AI approvals`}
        links={[
          {
            children: t`Workspace`,
            href: getSettingsPath(SettingsPath.General),
          },
          { children: t`AI approvals` },
        ]}
      >
        <SettingsPageContainer>
          <div>{t`Loading…`}</div>
        </SettingsPageContainer>
      </SettingsPageLayout>
    );
  }

  if (proposals.length === 0) {
    return (
      <SettingsPageLayout
        title={t`AI approvals`}
        links={[
          {
            children: t`Workspace`,
            href: getSettingsPath(SettingsPath.General),
          },
          { children: t`AI approvals` },
        ]}
      >
        <SettingsPageContainer>
          <div>{t`No AI changes are waiting for review.`}</div>
        </SettingsPageContainer>
      </SettingsPageLayout>
    );
  }

  return (
    <SettingsPageLayout
      title={t`AI approvals`}
      links={[
        {
          children: t`Workspace`,
          href: getSettingsPath(SettingsPath.General),
        },
        { children: t`AI approvals` },
      ]}
    >
      <SettingsPageContainer>
        <div>
          {proposals.map((proposal: Proposal) => (
            <StyledProposal key={proposal.id}>
              <StyledHeading>
                {proposal.items.length} proposed change
                {proposal.items.length === 1 ? '' : 's'}
              </StyledHeading>
              <ProposalDiffTable
                items={proposal.items}
                onApprove={(selectedItemIds) =>
                  handleApprove(proposal.id, selectedItemIds)
                }
                onReject={() => handleReject(proposal.id)}
              />
            </StyledProposal>
          ))}
        </div>
      </SettingsPageContainer>
    </SettingsPageLayout>
  );
};
