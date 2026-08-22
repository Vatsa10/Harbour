import { Injectable } from '@nestjs/common';

import { isDefined } from 'searm-shared/utils';

import { KeyValuePairType } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { KeyValuePairService } from 'src/engine/core-modules/key-value-pair/key-value-pair.service';
import {
  EMPTY_INGESTION_SUPPRESSION,
  INGESTION_SUPPRESSION_KEY,
  type IngestionSuppression,
  type IngestionSuppressionKeyValueTypeMap,
} from 'src/modules/ingestion-noise-filter/types/ingestion-suppression.type';
import { isBuiltInNoiseHandle } from 'src/modules/ingestion-noise-filter/utils/is-noise-handle.util';
import {
  normalizeSuppressionDomain,
  normalizeSuppressionEmail,
  rawDomainFromHandle,
} from 'src/modules/ingestion-noise-filter/utils/normalize-handle.util';

// A resolved filter, so a batch of contacts costs one settings read rather
// than one per handle.
export type IngestionNoiseFilter = {
  isSuppressed: (handle: string) => boolean;
};

@Injectable()
export class IngestionSuppressionService {
  constructor(
    private readonly keyValuePairService: KeyValuePairService<IngestionSuppressionKeyValueTypeMap>,
  ) {}

  async getSuppression(workspaceId: string): Promise<IngestionSuppression> {
    const result = await this.keyValuePairService.get({
      workspaceId,
      userId: null,
      type: KeyValuePairType.CONFIG_VARIABLE,
      key: INGESTION_SUPPRESSION_KEY,
    });

    // KeyValuePairService.get() resolves an array of matching rows; a
    // workspace only ever holds one row for this key.
    const stored = Array.isArray(result)
      ? (result[0] as { value?: IngestionSuppression } | undefined)?.value
      : result;

    return isDefined(stored)
      ? this.sanitize(stored as Partial<IngestionSuppression>)
      : EMPTY_INGESTION_SUPPRESSION;
  }

  async setSuppression(
    workspaceId: string,
    suppression: Partial<IngestionSuppression>,
  ): Promise<IngestionSuppression> {
    const sanitized = this.sanitize(suppression);

    await this.keyValuePairService.set({
      workspaceId,
      userId: null,
      type: KeyValuePairType.CONFIG_VARIABLE,
      key: INGESTION_SUPPRESSION_KEY,
      value: sanitized,
    });

    return sanitized;
  }

  // Entries are normalised on the way in and on the way out: a blob written by
  // an older client can hold `Gmail.COM ` or a non-string, and an unnormalised
  // entry would silently never match.
  private sanitize(
    stored: Partial<IngestionSuppression>,
  ): IngestionSuppression {
    const normalizeList = (
      values: unknown,
      normalize: (value: string) => string | null,
    ): string[] => {
      if (!Array.isArray(values)) {
        return [];
      }

      const normalized = values
        .filter((value): value is string => typeof value === 'string')
        .map(normalize)
        .filter((value): value is string => isDefined(value));

      return [...new Set(normalized)].sort();
    };

    return {
      suppressedDomains: normalizeList(
        stored.suppressedDomains,
        normalizeSuppressionDomain,
      ),
      suppressedEmails: normalizeList(
        stored.suppressedEmails,
        normalizeSuppressionEmail,
      ),
    };
  }

  // The single question the ingestion path asks: may this participant become a
  // record? Built-in noise first (it needs no I/O), then the tenant lists.
  async buildFilter(workspaceId: string): Promise<IngestionNoiseFilter> {
    const { suppressedDomains, suppressedEmails } =
      await this.getSuppression(workspaceId);

    const domainSet = new Set(suppressedDomains);
    const emailSet = new Set(suppressedEmails);

    return {
      isSuppressed: (handle: string): boolean => {
        const normalized = handle.trim().toLowerCase();

        if (isBuiltInNoiseHandle(normalized)) {
          return true;
        }

        if (emailSet.has(normalized)) {
          return true;
        }

        const domain =
          normalizeSuppressionDomain(rawDomainFromHandle(normalized)) ??
          rawDomainFromHandle(normalized);

        return isDefined(domain) && domainSet.has(domain);
      },
    };
  }
}
