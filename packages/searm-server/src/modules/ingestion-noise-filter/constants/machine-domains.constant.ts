// Domains owned by mail/calendar infrastructure rather than by an
// organisation. A participant here is a delivery mechanism, not a contact.
export const MACHINE_DOMAINS = new Set<string>([
  'calendar.google.com',
  'googlegroups.com',
  'docs.google.com',
  'drive.google.com',
  'appspotmail.com',
  'amazonses.com',
  'sendgrid.net',
  'zoomcrc.com',
]);

// Suffix match, because these are per-tenant subdomains: every bounce address
// is `<something>.bounces.google.com`, every calendar resource lives under
// `<workspace>.calendar.google.com`.
export const MACHINE_DOMAIN_SUFFIXES = [
  '.calendar.google.com',
  '.bounces.google.com',
  '.appspotmail.com',
  '.amazonses.com',
  '.sendgrid.net',
  '.invalid',
  '.local',
  '.localhost',
] as const;
