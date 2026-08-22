import { styled } from '@linaria/react';
import { type ReactNode } from 'react';
import { themeCssVariables } from 'searm-ui/theme-constants';

const StyledContainer = styled.div`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[4]};
`;

type UsageInfoContainerProps = {
  children: ReactNode;
};

export const UsageInfoContainer = ({ children }: UsageInfoContainerProps) => (
  <StyledContainer>{children}</StyledContainer>
);
