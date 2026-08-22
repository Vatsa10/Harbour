// Normalises a raw domain (or a bare host with scheme/www noise) to the bare
// lowercase host, or null when the input is not host-shaped at all.
export const normalizeSuppressionDomain = (
  input: string | null | undefined,
): string | null => {
  const trimmed = input?.trim().toLowerCase();

  if (!trimmed) {
    return null;
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let host: string;

  try {
    host = new URL(withScheme).hostname;
  } catch {
    return null;
  }

  const bare = host.replace(/^www\./, '');

  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(bare) ? bare : null;
};

export const normalizeSuppressionEmail = (
  input: string | null | undefined,
): string | null => {
  const trimmed = input?.trim().toLowerCase();

  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return null;
  }

  return trimmed;
};

// The part after the last `@`, unnormalised. Used by the machine-domain check,
// which must still fire on hosts that fail domain normalisation.
export const rawDomainFromHandle = (handle: string): string | null => {
  const at = handle.lastIndexOf('@');

  return at < 1 ? null : handle.slice(at + 1).trim().toLowerCase();
};

export const localPartFromHandle = (handle: string): string | null => {
  const at = handle.lastIndexOf('@');

  return at < 1 ? null : handle.slice(0, at).toLowerCase();
};
