import { gql } from '@apollo/client';

export const WORKFLOW_TEMPLATES = gql`
  query WorkflowTemplates {
    workflowTemplates {
      key
      name
      description
    }
  }
`;
