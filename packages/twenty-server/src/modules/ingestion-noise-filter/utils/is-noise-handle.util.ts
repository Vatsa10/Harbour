import {
  AUTOMATED_LOCAL_PARTS,
  OPAQUE_LOCAL_PART_PATTERNS,
} from 'src/modules/ingestion-noise-filter/constants/automated-local-parts.constant';
import {
  MACHINE_DOMAINS,
  MACHINE_DOMAIN_SUFFIXES,
} from 'src/modules/ingestion-noise-filter/constants/machine-domains.constant';
import {
  localPartFromHandle,
  normalizeSuppressionDomain,
  rawDomainFromHandle,
} from 'src/modules/ingestion-noise-filter/utils/normalize-handle.util';

export const isMachineDomain = (input: string | null | undefined): boolean => {
  const domain = normalizeSuppressionDomain(input);

  if (domain === null) {
    return false;
  }

  return (
    MACHINE_DOMAINS.has(domain) ||
    MACHINE_DOMAIN_SUFFIXES.some((suffix) => domain.endsWith(suffix))
  );
};

// `support+123@`, `noreply-eu@` and `bounces_7@` are the same mailbox class as
// the bare local-part, so the separator-prefixed forms match too. A plain
// prefix match would wrongly catch `helена`-style real names like `teamer@`.
export const isAutomatedHandle = (handle: string): boolean => {
  const local = localPartFromHandle(handle);

  if (local === null || local === '') {
    return true;
  }

  return AUTOMATED_LOCAL_PARTS.some(
    (pattern) =>
      local === pattern ||
      local.startsWith(`${pattern}-`) ||
      local.startsWith(`${pattern}+`) ||
      local.startsWith(`${pattern}_`),
  );
};

export const isMachineHandle = (handle: string): boolean => {
  const domain = rawDomainFromHandle(handle);

  if (domain === null) {
    return true;
  }

  if (isMachineDomain(domain)) {
    return true;
  }

  const local = localPartFromHandle(handle) ?? '';

  return OPAQUE_LOCAL_PART_PATTERNS.some((pattern) => pattern.test(local));
};

// The built-in half of the inbound noise filter. Tenant-curated suppression is
// layered on top of this by IngestionSuppressionService.
export const isBuiltInNoiseHandle = (handle: string): boolean => {
  const normalized = handle.trim().toLowerCase();

  if (normalized === '' || !normalized.includes('@')) {
    return true;
  }

  return isMachineHandle(normalized) || isAutomatedHandle(normalized);
};
