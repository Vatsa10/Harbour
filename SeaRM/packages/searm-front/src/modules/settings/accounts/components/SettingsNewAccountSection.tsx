import { SettingsAccountsListEmptyStateCard } from '@/settings/accounts/components/SettingsAccountsListEmptyStateCard';
import { t } from '@lingui/core/macro';
import { H2Title } from 'searm-ui/typography';
import { Section } from 'searm-ui/layout';

export const SettingsNewAccountSection = () => {
  return (
    <Section>
      <H2Title
        title={t`New account`}
        description={t`Connect a new account to your workspace`}
      />
      <SettingsAccountsListEmptyStateCard />
    </Section>
  );
};
