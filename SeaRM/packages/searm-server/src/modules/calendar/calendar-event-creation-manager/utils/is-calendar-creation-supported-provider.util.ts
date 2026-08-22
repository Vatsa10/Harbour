import { ConnectedAccountProvider } from 'searm-shared/types';

export const isCalendarCreationSupportedProvider = (
  provider: ConnectedAccountProvider,
): boolean =>
  provider === ConnectedAccountProvider.GOOGLE ||
  provider === ConnectedAccountProvider.MICROSOFT ||
  provider === ConnectedAccountProvider.IMAP_SMTP_CALDAV;
