import { gql } from '@apollo/client';

export const INSTALL_WORKFLOW_TEMPLATE = gql`
  mutation InstallWorkflowTemplate($input: InstallWorkflowTemplateInput!) {
    installWorkflowTemplate(input: $input) {
      workflowId
      workflowVersionId
    }
  }
`;
