import {
  isAutomatedHandle,
  isBuiltInNoiseHandle,
  isMachineDomain,
  isMachineHandle,
} from 'src/modules/ingestion-noise-filter/utils/is-noise-handle.util';

describe('inbound noise filter built-ins', () => {
  describe('isAutomatedHandle', () => {
    it.each([
      'noreply@acme.com',
      'no-reply@acme.com',
      'mailer-daemon@acme.com',
      'postmaster@acme.com',
      'bounces@acme.com',
      'notifications@acme.com',
      'billing@acme.com',
    ])('should flag the role address %s', (handle) => {
      expect(isAutomatedHandle(handle)).toBe(true);
    });

    it.each(['support+123@acme.com', 'noreply-eu@acme.com', 'bounce_7@acme.com'])(
      'should flag the separator-suffixed form %s',
      (handle) => {
        expect(isAutomatedHandle(handle)).toBe(true);
      },
    );

    it.each(['teamer@acme.com', 'infosys@acme.com', 'jane.doe@acme.com'])(
      'should not flag the real name %s that merely starts with a role word',
      (handle) => {
        expect(isAutomatedHandle(handle)).toBe(false);
      },
    );
  });

  describe('isMachineDomain', () => {
    it.each([
      'calendar.google.com',
      'googlegroups.com',
      'amazonses.com',
      'sendgrid.net',
    ])('should flag the machine domain %s', (domain) => {
      expect(isMachineDomain(domain)).toBe(true);
    });

    it.each([
      'eu.bounces.google.com',
      'app.appspotmail.com',
      'mail.amazonses.com',
    ])('should flag the machine suffix under %s', (domain) => {
      expect(isMachineDomain(domain)).toBe(true);
    });

    it('should not flag an ordinary company domain', () => {
      expect(isMachineDomain('acme.com')).toBe(false);
    });
  });

  describe('isMachineHandle', () => {
    it('should flag an opaque hex local-part', () => {
      expect(
        isMachineHandle('c_0123456789abcdef0123456789@resource.calendar.google.com'),
      ).toBe(true);
    });

    it('should flag a bare-UUID local-part', () => {
      expect(
        isMachineHandle('123e4567-e89b-12d3-a456-426614174000@acme.com'),
      ).toBe(true);
    });

    it('should not flag a human address on a real domain', () => {
      expect(isMachineHandle('jane.doe@acme.com')).toBe(false);
    });
  });

  describe('isBuiltInNoiseHandle', () => {
    it('should suppress noreply at a machine domain — the real ingestion gap', () => {
      expect(isBuiltInNoiseHandle('noreply@calendar.google.com')).toBe(true);
    });

    it.each(['', '   ', 'not-an-email'])(
      'should suppress the malformed handle %p',
      (handle) => {
        expect(isBuiltInNoiseHandle(handle)).toBe(true);
      },
    );

    it('should let a real person through', () => {
      expect(isBuiltInNoiseHandle('Jane.Doe@Acme.com '.toLowerCase())).toBe(
        false,
      );
    });

    it('should let a personal free-mail address through as a contact', () => {
      // Free-email domains only block *company* creation upstream; the person
      // is still a legitimate contact, so the noise filter must not drop them.
      expect(isBuiltInNoiseHandle('jane.doe@gmail.com')).toBe(false);
    });
  });
});
