import { styled } from '@linaria/react';
import { themeCssVariables } from 'searm-ui/theme-constants';

const StyledIconAndNameContainer = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
  margin-left: ${themeCssVariables.spacing[1]};
  margin-right: ${themeCssVariables.spacing[1]};
`;

export { StyledIconAndNameContainer as ViewPickerIconAndNameContainer };
