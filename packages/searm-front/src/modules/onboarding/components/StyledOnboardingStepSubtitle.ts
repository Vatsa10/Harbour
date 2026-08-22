import { styled } from '@linaria/react';
import { themeCssVariables } from 'searm-ui/theme-constants';

export const StyledOnboardingStepSubtitle = styled.p`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.md};
  line-height: 1.4;
  margin: 0;
`;
