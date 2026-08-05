import { gql } from '@apollo/client';

export const APPROVE_PROPOSAL = gql`
  mutation ApproveProposal($input: ApproveProposalInput!) {
    approveProposal(input: $input) {
      proposalId
      appliedItemIds
      conflictedItemIds
      failedItemIds
      aborted
    }
  }
`;

export const REJECT_PROPOSAL = gql`
  mutation RejectProposal($input: RejectProposalInput!) {
    rejectProposal(input: $input) {
      proposalId
      aborted
    }
  }
`;
