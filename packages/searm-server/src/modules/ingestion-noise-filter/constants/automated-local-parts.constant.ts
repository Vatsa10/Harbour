// Local-parts that identify a mailbox as a role account, an auto-responder or
// a notification sender rather than a person. Ingesting them mints a junk
// Person (and often a junk Company) on the very first newsletter or receipt.
export const AUTOMATED_LOCAL_PARTS = [
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'notifications',
  'notification',
  'mailer-daemon',
  'postmaster',
  'bounce',
  'bounces',
  'auto-confirm',
  'automated',
  'calendar-invite',
  'calendar',
  'invite',
  'invites',
  'invitations',
  'meetings',
  'scheduling',
  'booking',
  'bookings',
  'reply',
  'support',
  'help',
  'hello',
  'info',
  'contact',
  'sales',
  'billing',
  'accounts',
  'team',
] as const;

// Google Calendar resource/room pseudo-addresses and other opaque machine
// identities: a hex blob or a bare UUID is never a human's mailbox name.
export const OPAQUE_LOCAL_PART_PATTERNS = [
  /^(c_)?[0-9a-f]{24,}$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
] as const;
