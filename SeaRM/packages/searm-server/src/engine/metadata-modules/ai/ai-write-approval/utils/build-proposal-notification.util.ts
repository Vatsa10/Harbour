import { type RaiseNotificationInput } from 'src/engine/core-modules/notification/services/notification.service';

// The settings route the approval inbox lives at. Kept as a literal because
// the server has no dependency on the frontend's SettingsPath enum.
export const PROPOSAL_INBOX_PATH = '/settings/ai/approvals';

// One notification per proposal, keyed on the proposal id, so a retried job or
// a second tool call joining the same batch cannot raise a duplicate.
export const buildProposalNotification = (params: {
  workspaceId: string;
  proposalId: string;
  reason?: string | null;
}): RaiseNotificationInput => ({
  workspaceId: params.workspaceId,
  title: 'A proposal is waiting for review',
  body:
    params.reason ??
    'An AI-drafted change needs your approval before it touches any record.',
  linkPath: PROPOSAL_INBOX_PATH,
  // Workspace-wide: a proposal has no assigned reviewer, so anyone who can
  // approve should be able to see that one is waiting.
  userWorkspaceId: null,
  dedupeKey: `proposal:${params.proposalId}`,
});
