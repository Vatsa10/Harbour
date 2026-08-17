import { Fragment } from 'react';

import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { isDefined } from 'twenty-shared/utils';
import { IconSparkles } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { useRecordBrief } from '@/record-brief/hooks/useRecordBrief';
import { humanizeSectionKey } from '@/record-brief/utils/humanizeSectionKey';
import { beautifyPastDateRelativeToNow } from '~/utils/date-utils';

const StyledContainer = styled.div`
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[3]};
`;

const StyledHeader = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.light};
  display: flex;
  font-size: ${themeCssVariables.font.size.xs};
  font-weight: ${themeCssVariables.font.weight.medium};
  gap: ${themeCssVariables.spacing[1]};
  justify-content: space-between;
`;

const StyledHeaderLabel = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
`;

const StyledNarrative = styled.p`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.md};
  line-height: ${themeCssVariables.text.lineHeight.md};
  margin: 0;
`;

const StyledSections = styled.dl`
  display: grid;
  gap: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
  grid-template-columns: auto minmax(0, 1fr);
  margin: 0;
`;

const StyledSectionLabel = styled.dt`
  color: ${themeCssVariables.font.color.light};
  font-size: ${themeCssVariables.font.size.xs};
`;

const StyledSectionValue = styled.dd`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.xs};
  margin: 0;
  overflow-wrap: anywhere;
`;

const StyledFootnote = styled.div`
  color: ${themeCssVariables.font.color.light};
  font-size: ${themeCssVariables.font.size.xxs};
`;

type RecordBriefPanelProps = {
  objectNameSingular: string;
  recordId: string;
};

// Absence is the feature. A record with no evidence behind it renders no
// prose at all — no placeholder paragraph, no "we could not find much", no
// hedged summary. The panel shrinks to a single quiet action, and after a
// refusal to a single quiet sentence saying nothing was written and why.
export const RecordBriefPanel = ({
  objectNameSingular,
  recordId,
}: RecordBriefPanelProps) => {
  const { t } = useLingui();
  const { brief, loading, isGenerating, refusalReason, generateBrief } =
    useRecordBrief({ objectNameSingular, recordId });

  // Nothing at all until the first answer arrives: a skeleton here would be a
  // promise of content the record most likely does not have.
  if (loading) {
    return null;
  }

  const refusalMessage =
    refusalReason === 'NARRATIVE_BELOW_FLOOR'
      ? t`No brief written — the sourced facts add up to less than a sentence worth reading.`
      : t`No brief written — nothing about this record is backed by strong enough evidence yet.`;

  const sectionEntries = isDefined(brief)
    ? Object.entries(brief.sections)
    : [];

  return (
    <StyledContainer>
      <StyledHeader>
        <StyledHeaderLabel>
          <IconSparkles size={12} />
          {t`Brief`}
        </StyledHeaderLabel>
        <Button
          size="small"
          variant="tertiary"
          title={isDefined(brief) ? t`Refresh` : t`Generate`}
          disabled={isGenerating}
          onClick={generateBrief}
        />
      </StyledHeader>

      {isDefined(brief) ? (
        <>
          <StyledNarrative>{brief.narrative}</StyledNarrative>
          {sectionEntries.length > 0 && (
            <StyledSections>
              {sectionEntries.map(([sectionKey, sectionValue]) => (
                <Fragment key={sectionKey}>
                  <StyledSectionLabel>
                    {humanizeSectionKey(sectionKey)}
                  </StyledSectionLabel>
                  <StyledSectionValue>{sectionValue}</StyledSectionValue>
                </Fragment>
              ))}
            </StyledSections>
          )}
          <StyledFootnote>
            {t`${brief.factIds.length} sourced facts · oldest observed ${beautifyPastDateRelativeToNow(brief.oldestObservedAt)}`}
          </StyledFootnote>
        </>
      ) : (
        isDefined(refusalReason) && (
          <StyledFootnote>{refusalMessage}</StyledFootnote>
        )
      )}
    </StyledContainer>
  );
};
