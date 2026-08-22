import { isMultiWorkspaceEnabledState } from '@/client-config/states/isMultiWorkspaceEnabledState';
import { SettingsCard } from '@/settings/components/SettingsCard';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { SettingsPath } from 'searm-shared/types';
import { getSettingsPath } from 'searm-shared/utils';
import { IconWorldWww } from 'searm-ui/icon';
import { UndecoratedLink } from 'searm-ui/navigation';
import { MOBILE_VIEWPORT, themeCssVariables } from 'searm-ui/theme-constants';

const StyledContainer = styled.div`
  display: flex;
  flex-direction: row;
  gap: ${themeCssVariables.spacing[2]};

  @media (max-width: ${MOBILE_VIEWPORT}px) {
    flex-direction: column;
  }
`;

export const SettingsWorkspaceDomainCard = () => {
  const { t } = useLingui();
  const isMultiWorkspaceEnabled = useAtomStateValue(
    isMultiWorkspaceEnabledState,
  );

  if (!isMultiWorkspaceEnabled) {
    return null;
  }

  return (
    <StyledContainer>
      <UndecoratedLink to={getSettingsPath(SettingsPath.Subdomain)} fullWidth>
        <SettingsCard title={t`Subdomain`} Icon={<IconWorldWww />} />
      </UndecoratedLink>
    </StyledContainer>
  );
};
