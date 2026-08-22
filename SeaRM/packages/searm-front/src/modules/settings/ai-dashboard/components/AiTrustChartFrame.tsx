import { styled } from '@linaria/react';
import { type ReactNode } from 'react';
import { themeCssVariables } from 'searm-ui/theme-constants';

import { PageLayoutEditModeProviderContext } from '@/page-layout/contexts/PageLayoutEditModeContext';
import { PageLayoutComponentInstanceContext } from '@/page-layout/states/contexts/PageLayoutComponentInstanceContext';
import { WidgetComponentInstanceContext } from '@/page-layout/widgets/states/contexts/WidgetComponentInstanceContext';

const StyledCard = styled.section`
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[4]};
`;

const StyledTitle = styled.h3`
  font-size: ${themeCssVariables.font.size.md};
  font-weight: ${themeCssVariables.font.weight.medium};
  margin: 0;
`;

const StyledCaption = styled.p`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
  margin: 0;
`;

// Nivo's ResponsivePie/Bar collapse to nothing inside an auto-height parent.
const StyledChartArea = styled.div`
  height: 240px;
  width: 100%;
`;

type AiTrustChartFrameProps = {
  title: string;
  caption?: string;
  // Distinct per chart: the widget charts key their hover/tooltip jotai state
  // off this instance id, so two frames sharing one id would share a tooltip.
  instanceId: string;
  children: ReactNode;
};

// The page-layout bar chart reads three contexts that only exist inside a
// dashboard widget. Rather than fork the chart, this frame supplies them so a
// settings page can render the repo's existing chart machinery unchanged.
// isInEditMode is false: nothing here is a configurable widget.
export const AiTrustChartFrame = ({
  title,
  caption,
  instanceId,
  children,
}: AiTrustChartFrameProps) => (
  <StyledCard>
    <StyledTitle>{title}</StyledTitle>
    {caption !== undefined && <StyledCaption>{caption}</StyledCaption>}
    <PageLayoutEditModeProviderContext value={{ isInEditMode: false }}>
      <PageLayoutComponentInstanceContext.Provider
        value={{ instanceId: `ai-trust-dashboard` }}
      >
        <WidgetComponentInstanceContext.Provider value={{ instanceId }}>
          <StyledChartArea>{children}</StyledChartArea>
        </WidgetComponentInstanceContext.Provider>
      </PageLayoutComponentInstanceContext.Provider>
    </PageLayoutEditModeProviderContext>
  </StyledCard>
);
