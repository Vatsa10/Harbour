import { createElement } from 'react';

import {
  BillingSubscriptionRenewingEmail,
  BillingTrialConvertingEmail,
  BillingTrialEndingEmail,
  CleanSuspendedWorkspaceEmail,
  PasswordResetLinkEmail,
  PasswordUpdateNotifyEmail,
  SendApprovedAccessDomainValidation,
  SendEmailVerificationLinkEmail,
  SendInviteLinkEmail,
  ServerAdminAccessChangedEmail,
  WarnSuspendedWorkspaceEmail,
  EmailRenderError,
  renderEmail,
} from 'searm-emails';

const WORKSPACE = { name: 'Acme Inc', logo: undefined };
const SENDER = {
  email: 'tim@searm.com',
  firstName: 'Tim',
  lastName: 'Apple',
};

const TEMPLATES = [
  {
    name: 'BillingSubscriptionRenewingEmail',
    element: BillingSubscriptionRenewingEmail({
      userName: 'Tim',
      workspaceDisplayName: 'Acme Inc',
      renewsAt: new Date('2026-01-01'),
      link: 'https://app.searm.com/settings/billing',
      locale: 'en',
    }),
    expectedContent: 'https://app.searm.com/settings/billing',
  },
  {
    name: 'BillingTrialConvertingEmail',
    element: BillingTrialConvertingEmail({
      userName: 'Tim',
      workspaceDisplayName: 'Acme Inc',
      trialEndsAt: new Date('2026-01-01'),
      interval: 'month',
      link: 'https://app.searm.com/settings/billing',
      locale: 'en',
    }),
    expectedContent: 'https://app.searm.com/settings/billing',
  },
  {
    name: 'BillingTrialEndingEmail',
    element: BillingTrialEndingEmail({
      userName: 'Tim',
      workspaceDisplayName: 'Acme Inc',
      trialEndsAt: new Date('2026-01-01'),
      dataRetentionDays: 30,
      link: 'https://app.searm.com/settings/billing',
      locale: 'en',
    }),
    expectedContent: 'https://app.searm.com/settings/billing',
  },
  {
    name: 'CleanSuspendedWorkspaceEmail',
    element: CleanSuspendedWorkspaceEmail({
      daysSinceInactive: 30,
      userName: 'Tim',
      workspaceDisplayName: 'Acme Inc',
      locale: 'en',
    }),
    expectedContent: 'Acme Inc',
  },
  {
    name: 'PasswordResetLinkEmail',
    element: PasswordResetLinkEmail({
      duration: '5 minutes',
      hasPassword: true,
      link: 'https://app.searm.com/reset-password',
      locale: 'en',
    }),
    expectedContent: 'https://app.searm.com/reset-password',
  },
  {
    name: 'PasswordUpdateNotifyEmail',
    element: PasswordUpdateNotifyEmail({
      userName: 'Tim',
      email: 'tim@searm.com',
      link: 'https://app.searm.com',
      locale: 'en',
    }),
    expectedContent: 'tim@searm.com',
  },
  {
    name: 'SendApprovedAccessDomainValidation',
    element: SendApprovedAccessDomainValidation({
      link: 'https://app.searm.com/validate-approved-access-domain',
      domain: 'acme.com',
      workspace: WORKSPACE,
      sender: SENDER,
      serverUrl: 'https://app.searm.com',
      locale: 'en',
    }),
    expectedContent: 'https://app.searm.com/validate-approved-access-domain',
  },
  {
    name: 'SendEmailVerificationLinkEmail',
    element: SendEmailVerificationLinkEmail({
      link: 'https://app.searm.com/verify-email',
      locale: 'en',
    }),
    expectedContent: 'https://app.searm.com/verify-email',
  },
  {
    name: 'SendInviteLinkEmail',
    element: SendInviteLinkEmail({
      link: 'https://app.searm.com/invite/token',
      workspace: WORKSPACE,
      sender: SENDER,
      serverUrl: 'https://app.searm.com',
      locale: 'en',
    }),
    expectedContent: 'https://app.searm.com/invite/token',
  },
  {
    name: 'ServerAdminAccessChangedEmail',
    element: ServerAdminAccessChangedEmail({
      actorName: 'Tim',
      targetName: 'Jony',
      targetEmail: 'jony@searm.com',
      canAccessFullAdminPanel: true,
      canImpersonate: false,
      locale: 'en',
    }),
    expectedContent: 'jony@searm.com',
  },
  {
    name: 'WarnSuspendedWorkspaceEmail',
    element: WarnSuspendedWorkspaceEmail({
      daysSinceInactive: 30,
      inactiveDaysBeforeDelete: 60,
      userName: 'Tim',
      workspaceDisplayName: 'Acme Inc',
      link: 'https://app.searm.com/settings/billing',
      locale: 'en',
    }),
    expectedContent: 'https://app.searm.com/settings/billing',
  },
];

// Transactional emails went out with an empty body for a month without a single
// test noticing, because every email spec mocks the renderer (#23307). These
// specs run the real render path instead.
describe('email templates rendering', () => {
  // render() resolves through a streaming scheduler that never advances under
  // the globally enabled fake timers.
  beforeAll(() => {
    jest.useRealTimers();
  });

  afterAll(() => {
    jest.useFakeTimers();
  });

  it.each(TEMPLATES)(
    'should render $name to a complete HTML body',
    async ({ element, expectedContent }) => {
      const html = await renderEmail(element);

      expect(html).not.toContain('<!--$!-->');
      expect(html).not.toContain('<template></template>');
      expect(html).toContain('</html>');
      expect(html).toContain(expectedContent);
    },
  );

  it.each(TEMPLATES)(
    'should render $name to a non-empty plain text body',
    async ({ element }) => {
      const text = await renderEmail(element, { plainText: true });

      expect(text.trim().length).toBeGreaterThan(0);
      expect(text).not.toContain('<');
    },
  );

  it('should render translated content for a non-english locale', async () => {
    const html = await renderEmail(
      PasswordResetLinkEmail({
        duration: '5 minutes',
        hasPassword: true,
        link: 'https://app.searm.com/reset-password',
        locale: 'fr-FR',
      }),
    );

    expect(html).toContain('mot de passe');
  });
});

describe('renderEmail guard', () => {
  beforeAll(() => {
    jest.useRealTimers();
  });

  afterAll(() => {
    jest.useFakeTimers();
  });

  // @react-email/render 1.x turned a throw into `<!--$!--><template></template>`
  // and resolved, so the send went out blank. Whatever the renderer does, a
  // failed render must never reach the recipient as an empty email.
  it('should reject rather than resolve a blank body when a component throws', async () => {
    const ThrowingComponent = () => {
      throw new Error('boom');
    };

    await expect(renderEmail(createElement(ThrowingComponent))).rejects.toThrow(
      /boom|Email template/,
    );
  });

  it('should throw EmailRenderError when a template produces no text body', async () => {
    const EmptyComponent = () => null;

    await expect(
      renderEmail(createElement(EmptyComponent), { plainText: true }),
    ).rejects.toThrow(EmailRenderError);
  });
});
