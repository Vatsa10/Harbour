import { styled } from '@linaria/react';
import { Status } from 'searm-ui/data-display';
import { AppTooltip } from 'searm-ui/surfaces';
import { type ThemeColor } from 'searm-ui/theme';

const StyledContainer = styled.div`
  align-items: center;
  display: flex;
  justify-content: center;
`;

type PageLayoutWidgetStatusDisplayProps = {
  tooltipId: string;
  text: string;
  tooltipContent: string;
  color?: ThemeColor;
};

export const PageLayoutWidgetStatusDisplay = ({
  tooltipId,
  text,
  tooltipContent,
  color = 'red',
}: PageLayoutWidgetStatusDisplayProps) => {
  return (
    <StyledContainer>
      <div id={tooltipId}>
        <Status color={color} text={text} />
      </div>
      <AppTooltip
        anchorSelect={`#${tooltipId}`}
        content={tooltipContent}
        place="top"
      />
    </StyledContainer>
  );
};
