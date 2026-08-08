import { useMutation, useQuery } from '@apollo/client/react';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { WorkflowTemplateCard } from '@/settings/workflow-templates/components/WorkflowTemplateCard';
import { INSTALL_WORKFLOW_TEMPLATE } from '@/settings/workflow-templates/graphql/mutations/installWorkflowTemplate';
import { WORKFLOW_TEMPLATES } from '@/settings/workflow-templates/graphql/queries/workflowTemplates';
import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { SettingsPageLayout } from '@/settings/components/layout/SettingsPageLayout';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';

type WorkflowTemplateSummary = {
  key: string;
  name: string;
  description: string;
};

type WorkflowTemplatesData = {
  workflowTemplates: WorkflowTemplateSummary[];
};

const StyledGrid = styled.div`
  display: grid;
  gap: ${themeCssVariables.spacing[4]};
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
`;

export const SettingsWorkflowTemplates = () => {
  const { data, loading } = useQuery<WorkflowTemplatesData>(
    WORKFLOW_TEMPLATES,
  );
  const [installWorkflowTemplate] = useMutation(INSTALL_WORKFLOW_TEMPLATE);

  const templates = data?.workflowTemplates ?? [];

  const handleInstall = async (key: string) => {
    await installWorkflowTemplate({
      variables: { input: { key, activate: false } },
    });
  };

  const links = [
    {
      children: t`Workspace`,
      href: getSettingsPath(SettingsPath.General),
    },
    { children: t`Workflow templates` },
  ];

  if (loading) {
    return (
      <SettingsPageLayout title={t`Workflow templates`} links={links}>
        <SettingsPageContainer>
          <div>{t`Loading…`}</div>
        </SettingsPageContainer>
      </SettingsPageLayout>
    );
  }

  return (
    <SettingsPageLayout title={t`Workflow templates`} links={links}>
      <SettingsPageContainer>
        <StyledGrid>
          {templates.map((template) => (
            <WorkflowTemplateCard
              key={template.key}
              template={template}
              onInstall={handleInstall}
            />
          ))}
        </StyledGrid>
      </SettingsPageContainer>
    </SettingsPageLayout>
  );
};
