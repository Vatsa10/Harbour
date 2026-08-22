import { currentWorkspaceMemberState } from '@/auth/states/currentWorkspaceMemberState';
import { SettingsCard } from '@/settings/components/SettingsCard';
import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { SetOrChangePassword } from '@/settings/profile/components/SetOrChangePassword';
import { DeleteAccount } from '@/settings/profile/components/DeleteAccount';
import { SettingsProfileDevicesSection } from '@/settings/profile/devices/components/SettingsProfileDevicesSection';
import { EmailField } from '@/settings/profile/components/EmailField';
import { NameFields } from '@/settings/profile/components/NameFields';
import { WorkspaceMemberPictureUploader } from '@/settings/workspace-member/components/WorkspaceMemberPictureUploader';
import { useCanChangePassword } from '@/settings/profile/hooks/useCanChangePassword';
import { useCurrentUserWorkspaceTwoFactorAuthentication } from '@/settings/two-factor-authentication/hooks/useCurrentUserWorkspaceTwoFactorAuthentication';
import { SettingsPageLayout } from '@/settings/components/layout/SettingsPageLayout';
import { Trans, useLingui } from '@lingui/react/macro';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { SettingsPath } from 'searm-shared/types';
import { getSettingsPath } from 'searm-shared/utils';
import { Status } from 'searm-ui/data-display';
import { IconShield } from 'searm-ui/icon';
import { H2Title } from 'searm-ui/typography';
import { Section } from 'searm-ui/layout';
import { UndecoratedLink } from 'searm-ui/navigation';

export const SettingsProfile = () => {
  const { t } = useLingui();
  const currentWorkspaceMember = useAtomStateValue(currentWorkspaceMemberState);

  const { currentUserWorkspaceTwoFactorAuthenticationMethods } =
    useCurrentUserWorkspaceTwoFactorAuthentication();

  const has2FAMethod =
    currentUserWorkspaceTwoFactorAuthenticationMethods['TOTP']?.status ===
    'VERIFIED';

  const { canChangePassword } = useCanChangePassword();

  if (!currentWorkspaceMember?.id) {
    return null;
  }

  return (
    <SettingsPageLayout
      title={t`Profile`}
      links={[
        {
          children: <Trans>User</Trans>,
          href: getSettingsPath(SettingsPath.ProfilePage),
        },
        { children: <Trans>Profile</Trans> },
      ]}
    >
      <SettingsPageContainer>
        <Section>
          <H2Title title={t`Picture`} />
          <WorkspaceMemberPictureUploader
            workspaceMemberId={currentWorkspaceMember.id}
          />
        </Section>
        <Section>
          <H2Title
            title={t`Name`}
            description={t`Your name as it will be displayed`}
          />
          <NameFields key={currentWorkspaceMember.id} />
        </Section>
        <Section>
          <H2Title
            title={t`Email`}
            description={t`The email associated to your account`}
          />
          <EmailField />
        </Section>
        <Section>
          <H2Title
            title={t`Two Factor Authentication`}
            description={t`Enhances security by requiring a code along with your password`}
          />
          <UndecoratedLink
            to={getSettingsPath(
              SettingsPath.TwoFactorAuthenticationStrategyConfig,
              { twoFactorAuthenticationStrategy: 'TOTP' },
            )}
          >
            <SettingsCard
              title={t`Authenticator App`}
              Icon={<IconShield />}
              Status={
                has2FAMethod ? (
                  <Status text={t`Active`} color="turquoise" />
                ) : (
                  <Status text={t`Deactivated`} color="gray" />
                )
              }
            />
          </UndecoratedLink>
        </Section>
        {canChangePassword && (
          <Section>
            <SetOrChangePassword />
          </Section>
        )}
        <SettingsProfileDevicesSection />
        <Section>
          <DeleteAccount />
        </Section>
      </SettingsPageContainer>
    </SettingsPageLayout>
  );
};
