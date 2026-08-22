import { styled } from '@linaria/react';
import { themeCssVariables } from 'searm-ui/theme-constants';

const StyledRow = styled.div`
  align-items: center;
  display: flex;
  justify-content: space-between;
`;

const StyledLabel = styled.span`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledValue = styled.span`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.medium};
`;

type UsageLabelValueItemProps = {
  label: string;
  value: string;
};

export const UsageLabelValueItem = ({
  label,
  value,
}: UsageLabelValueItemProps) => (
  <StyledRow>
    <StyledLabel>{label}</StyledLabel>
    <StyledValue>{value}</StyledValue>
  </StyledRow>
);
