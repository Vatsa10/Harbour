import { useMutation, useQuery } from '@apollo/client/react';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { WorkflowTemplateCard } from '@/settings/workflow-templates/components/WorkflowTemplateCard';
import { INSTALL_WORKFLOW_TEMPLATE } from '@/settings/workflow-templates/graphql/mutations/installWorkflowTemplate';
import { WORKFLOW_TEMPLATES } from '@/settings/workflow-templates/graphql/queries/workflowTemplates';
import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { SettingsPageLayout } from '@/settings/components/layout/SettingsPageLayout';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
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

const StyledMessage = styled.div`
  color: ${themeCssVariables.font.color.secondary};
`;

export const SettingsWorkflowTemplates = () => {
  const { data, loading, error } =
    useQuery<WorkflowTemplatesData>(WORKFLOW_TEMPLATES);
  const [installWorkflowTemplate] = useMutation(INSTALL_WORKFLOW_TEMPLATE);
  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();

  const [installingKey, setInstallingKey] = useState<string | null>(null);
  const [installedKeys, setInstalledKeys] = useState<string[]>([]);

  const templates = data?.workflowTemplates ?? [];

  const handleInstall = async (key: string) => {
    setInstallingKey(key);

    try {
      await installWorkflowTemplate({
        variables: { input: { key, activate: false } },
      });

      setInstalledKeys((previous) => [...previous, key]);
      enqueueSuccessSnackBar({
        message: t`Workflow installed. It is inactive until you activate it.`,
      });
    } catch {
      // A rejected mutation used to be an unhandled rejection: the button
      // stayed idle and the user was told nothing.
      enqueueErrorSnackBar({
        message: t`Could not install this workflow template.`,
      });
    } finally {
      setInstallingKey(null);
    }
  };

  const links = [
    {
      children: t`Workspace`,
      href: getSettingsPath(SettingsPath.General),
    },
    { children: t`Workflow templates` },
  ];

  const renderBody = () => {
    if (loading) {
      return <StyledMessage>{t`Loading…`}</StyledMessage>;
    }

    if (error) {
      return (
        <StyledMessage>{t`Could not load workflow templates.`}</StyledMessage>
      );
    }

    if (templates.length === 0) {
      return (
        <StyledMessage>{t`No workflow templates are available.`}</StyledMessage>
      );
    }

    return (
      <StyledGrid>
        {templates.map((template) => (
          <WorkflowTemplateCard
            key={template.key}
            template={template}
            onInstall={handleInstall}
            isInstalling={installingKey === template.key}
            isInstalled={installedKeys.includes(template.key)}
          />
        ))}
      </StyledGrid>
    );
  };

  return (
    <SettingsPageLayout title={t`Workflow templates`} links={links}>
      <SettingsPageContainer>{renderBody()}</SettingsPageContainer>
    </SettingsPageLayout>
  );
};
