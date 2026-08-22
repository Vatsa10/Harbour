import { Injectable } from '@nestjs/common';

import { isDefined } from 'searm-shared/utils';

import { buildUrlWithPathnameAndSearchParams } from 'src/engine/core-modules/domain/domain-server-config/utils/build-url-with-pathname-and-search-params.util';
import {
  getHostnameFromUrlOrUndefined,
  isHostUnderPublicFunctionDomain,
} from 'src/engine/core-modules/domain/domain-server-config/utils/public-function-domain.util';
import { SearmConfigService } from 'src/engine/core-modules/searm-config/searm-config.service';

@Injectable()
export class DomainServerConfigService {
  constructor(private readonly searmConfigService: SearmConfigService) {}

  getFrontUrl() {
    return new URL(
      this.searmConfigService.get('FRONTEND_URL') ??
        this.searmConfigService.get('SERVER_URL'),
    );
  }

  getBaseUrl(): URL {
    const baseUrl = this.getFrontUrl();

    if (
      this.searmConfigService.get('IS_MULTIWORKSPACE_ENABLED') &&
      this.searmConfigService.get('DEFAULT_SUBDOMAIN')
    ) {
      baseUrl.hostname = `${this.searmConfigService.get('DEFAULT_SUBDOMAIN')}.${baseUrl.hostname}`;
    }

    return baseUrl;
  }

  getPublicDomainUrl(): URL {
    return new URL(this.searmConfigService.get('PUBLIC_DOMAIN_URL'));
  }

  getPublicBaseHostnameOrUndefined(): string | undefined {
    return getHostnameFromUrlOrUndefined(
      this.searmConfigService.get('PUBLIC_DOMAIN_URL'),
    );
  }

  buildBaseUrl({
    pathname,
    searchParams,
    hash,
  }: {
    pathname?: string;
    searchParams?: Record<string, string | number>;
    hash?: string;
  }) {
    return buildUrlWithPathnameAndSearchParams({
      baseUrl: this.getBaseUrl(),
      pathname,
      searchParams,
      hash,
    });
  }

  getSubdomainAndDomainFromUrl = (url: string) => {
    const { hostname: originHostname } = new URL(url);

    const frontDomain = this.getFrontUrl().hostname;

    const isFrontdomain = originHostname.endsWith(`.${frontDomain}`);

    if (isFrontdomain) {
      const subdomain = originHostname.replace(`.${frontDomain}`, '');

      return {
        subdomain: this.isDefaultSubdomain(subdomain) ? undefined : subdomain,
        domain: null,
        isPublicDomainOrigin: false,
      };
    }

    const publicBaseDomain = this.getPublicBaseHostnameOrUndefined();

    if (
      isDefined(publicBaseDomain) &&
      isHostUnderPublicFunctionDomain({
        host: originHostname,
        publicDomainBaseHostname: publicBaseDomain,
      })
    ) {
      const subdomain = originHostname.replace(`.${publicBaseDomain}`, '');

      return {
        subdomain: this.isDefaultSubdomain(subdomain) ? undefined : subdomain,
        domain: null,
        isPublicDomainOrigin: true,
      };
    }

    return {
      subdomain: undefined,
      domain: originHostname,
      isPublicDomainOrigin: false,
    };
  };

  isDefaultSubdomain(subdomain: string) {
    return subdomain === this.searmConfigService.get('DEFAULT_SUBDOMAIN');
  }
}
