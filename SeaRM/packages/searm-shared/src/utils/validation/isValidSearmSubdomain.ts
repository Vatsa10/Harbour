import { SUBDOMAIN_PATTERN } from '@/constants/SubdomainPattern';

export const isValidSearmSubdomain = (subdomain: string): boolean => {
  return SUBDOMAIN_PATTERN.test(subdomain);
};
