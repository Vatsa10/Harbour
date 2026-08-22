import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'searm-shared/utils';
import { Repository } from 'typeorm';

import { getDomainNameFromHandle } from 'src/modules/contact-creation-manager/utils/get-domain-name-from-handle.util';
import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import { ImportRowMatchAction } from 'src/modules/guided-import/types/import-batch-status.type';
import {
  type IdentityMatch,
  IdentityResolutionService,
} from 'src/modules/match-participant/services/identity-resolution.service';

type RowVerdict = {
  matchAction: ImportRowMatchAction;
  matchedRecordId: string | null;
};

@Injectable()
export class ImportMatchResolutionService {
  constructor(
    private readonly identityResolutionService: IdentityResolutionService,
    @InjectRepository(ImportBatchEntity)
    private readonly importBatchRepository: Repository<ImportBatchEntity>,
    @InjectRepository(ImportRowEntity)
    private readonly importRowRepository: Repository<ImportRowEntity>,
  ) {}

  // Identity-aware dedup only exists for person/company today (Task 2's
  // scope). Every other object gets CREATE for every row — no worse than
  // today's spreadsheet import, which has no server-side dedup at all.
  // workspaceId is a required parameter, not something read off the batch it
  // just looked up: a batch id alone would let any caller that forgets to
  // check ownership resolve and rewrite another tenant's rows.
  async resolveBatch(importBatchId: string, workspaceId: string): Promise<void> {
    const batch = await this.importBatchRepository.findOne({
      where: { id: importBatchId, workspaceId },
    });

    if (!isDefined(batch)) {
      return;
    }

    const rows = await this.importRowRepository.find({
      where: { importBatchId },
    });

    for (const row of rows) {
      const { matchAction, matchedRecordId } = await this.resolveRow(
        batch.workspaceId,
        batch.objectNameSingular,
        row.mappedData ?? {},
      );

      await this.importRowRepository.save({
        ...row,
        matchAction,
        matchedRecordId,
      });
    }
  }

  private async resolveRow(
    workspaceId: string,
    objectNameSingular: string,
    mappedData: Record<string, unknown>,
  ): Promise<RowVerdict> {
    if (objectNameSingular === 'person') {
      const email = this.extractPersonEmail(mappedData);

      if (!isDefined(email)) {
        return {
          matchAction: ImportRowMatchAction.CREATE,
          matchedRecordId: null,
        };
      }

      const displayName = this.extractPersonDisplayName(mappedData);
      const match = await this.identityResolutionService.resolvePerson({
        workspaceId,
        email,
        displayName,
      });

      return this.matchToRowVerdict(match);
    }

    if (objectNameSingular === 'company') {
      const domain = this.extractCompanyDomain(mappedData);

      if (!isDefined(domain)) {
        return {
          matchAction: ImportRowMatchAction.CREATE,
          matchedRecordId: null,
        };
      }

      const match = await this.identityResolutionService.resolveCompany({
        workspaceId,
        domain,
      });

      return this.matchToRowVerdict(match);
    }

    return { matchAction: ImportRowMatchAction.CREATE, matchedRecordId: null };
  }

  private matchToRowVerdict(match: IdentityMatch): RowVerdict {
    if (match.kind === 'EXACT') {
      return {
        matchAction: ImportRowMatchAction.UPDATE,
        matchedRecordId: match.recordId,
      };
    }

    if (match.kind === 'CANDIDATE') {
      return {
        matchAction: ImportRowMatchAction.PROPOSE,
        matchedRecordId: match.recordId,
      };
    }

    return { matchAction: ImportRowMatchAction.CREATE, matchedRecordId: null };
  }

  private extractPersonEmail(
    mappedData: Record<string, unknown>,
  ): string | null {
    const emails = mappedData.emails as { primaryEmail?: string } | undefined;

    return emails?.primaryEmail ?? null;
  }

  private extractPersonDisplayName(
    mappedData: Record<string, unknown>,
  ): string | null {
    const name = mappedData.name as
      | { firstName?: string; lastName?: string }
      | undefined;

    if (!isDefined(name)) {
      return null;
    }

    return (
      [name.firstName, name.lastName].filter(isDefined).join(' ') || null
    );
  }

  private extractCompanyDomain(
    mappedData: Record<string, unknown>,
  ): string | null {
    const domainName = mappedData.domainName as
      | { primaryLinkUrl?: string }
      | undefined;

    if (!isDefined(domainName?.primaryLinkUrl)) {
      return null;
    }

    return getDomainNameFromHandle(
      `x@${domainName.primaryLinkUrl.replace(/^https?:\/\//, '')}`,
    );
  }
}
