import { styled } from '@linaria/react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { Button } from 'twenty-ui/input';

export type WorkflowTemplateSummary = {
  key: string;
  name: string;
  description: string;
};

type WorkflowTemplateCardProps = {
  template: WorkflowTemplateSummary;
  onInstall: (key: string) => void;
  isInstalling?: boolean;
  isInstalled?: boolean;
};

const StyledCard = styled.div`
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[4]};
`;

const StyledName = styled.h3`
  font-size: ${themeCssVariables.font.size.md};
  font-weight: ${themeCssVariables.font.weight.medium};
`;

const StyledDescription = styled.p`
  color: ${themeCssVariables.font.color.secondary};
`;

export const WorkflowTemplateCard = ({
  template,
  onInstall,
  isInstalling = false,
  isInstalled = false,
}: WorkflowTemplateCardProps) => (
  <StyledCard>
    <StyledName>{template.name}</StyledName>
    <StyledDescription>{template.description}</StyledDescription>
    <Button
      title={
        isInstalled ? 'Installed' : isInstalling ? 'Installing…' : 'Install'
      }
      accent="blue"
      disabled={isInstalling || isInstalled}
      onClick={() => onInstall(template.key)}
    />
  </StyledCard>
);
