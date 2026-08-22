import { RESERVED_SUBDOMAINS } from 'searm-shared/constants';
import { isValidSearmSubdomain } from 'searm-shared/utils';

export const isSubdomainValid = (subdomain: string) => {
  return (
    isValidSearmSubdomain(subdomain) &&
    !RESERVED_SUBDOMAINS.includes(subdomain.toLowerCase())
  );
};
