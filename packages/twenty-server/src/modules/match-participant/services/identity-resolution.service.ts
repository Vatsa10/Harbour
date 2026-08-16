import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';
import { ILike } from 'typeorm';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type CompanyWorkspaceEntity } from 'src/modules/company/standard-objects/company.workspace-entity';
import { extractDomainFromLink } from 'src/modules/contact-creation-manager/utils/extract-domain-from-link.util';
import { getDomainNameFromHandle } from 'src/modules/contact-creation-manager/utils/get-domain-name-from-handle.util';
import { addPersonEmailFiltersToQueryBuilder } from 'src/modules/match-participant/utils/add-person-email-filters-to-query-builder';
import { findPersonByPrimaryOrAdditionalEmail } from 'src/modules/match-participant/utils/find-person-by-primary-or-additional-email';
import { normalizePersonDisplayName } from 'src/modules/match-participant/utils/normalize-person-display-name.util';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

export type IdentityMatch =
  | { kind: 'EXACT'; recordId: string; matchedOn: string }
  | { kind: 'CANDIDATE'; recordId: string; explanation: string }
  | { kind: 'NONE' };

@Injectable()
export class IdentityResolutionService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  // EXACT is Twenty's existing deterministic rule (see
  // find-person-by-primary-or-additional-email.ts, used today by
  // MatchParticipantService and contact-creation-manager). CANDIDATE requires
  // BOTH a company-domain match AND a name match — one signal alone is a
  // different person who happens to share an attribute, not a weaker match.
  async resolvePerson(params: {
    workspaceId: string;
    email: string;
    displayName?: string | null;
  }): Promise<IdentityMatch> {
    const { workspaceId, email, displayName } = params;

    // Callers reach this from a GraphQL resolver, a BullMQ job, and a sync
    // listener; only the last already holds a workspace context. Establishing
    // it here means every caller works instead of the ORM throwing
    // "Workspace context not set" on two of the three paths.
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      () => this.resolvePersonInContext(workspaceId, email, displayName),
      buildSystemAuthContext(workspaceId),
      { lite: true },
    );
  }

  private async resolvePersonInContext(
    workspaceId: string,
    email: string,
    displayName?: string | null,
  ): Promise<IdentityMatch> {
    // Read-only lookup across the whole workspace: identity resolution has to
    // see records the calling actor may not, otherwise it would silently
    // duplicate people. Nothing is written here — the caller performs the write
    // under its own role.
    const personRepository =
      await this.globalWorkspaceOrmManager.getRepository<PersonWorkspaceEntity>(
        workspaceId,
        'person',
        { shouldBypassPermissionChecks: true },
      );

    const queryBuilder = addPersonEmailFiltersToQueryBuilder({
      queryBuilder: personRepository.createQueryBuilder('person'),
      emails: [email],
    });

    const candidatesByEmail = await queryBuilder
      .orderBy('person.createdAt', 'ASC')
      .getMany();

    // The SQL filter is a superset (jsonb containment plus a lowercased IN),
    // so the exact rule is re-applied in memory rather than trusting row order.
    const exactMatch = findPersonByPrimaryOrAdditionalEmail({
      people: candidatesByEmail,
      email,
    });

    if (isDefined(exactMatch)) {
      return {
        kind: 'EXACT',
        recordId: exactMatch.id,
        matchedOn: `email ${email} matches an email already on file for this person`,
      };
    }

    if (!displayName) {
      return { kind: 'NONE' };
    }

    const domain = getDomainNameFromHandle(email);

    if (!domain) {
      return { kind: 'NONE' };
    }

    const companyRepository =
      await this.globalWorkspaceOrmManager.getRepository<CompanyWorkspaceEntity>(
        workspaceId,
        'company',
        { shouldBypassPermissionChecks: true },
      );

    const companiesAtDomain = await companyRepository.find({
      where: { domainName: { primaryLinkUrl: ILike(`%${domain}%`) } },
    });

    // ILike is only a cheap prefilter: "notacme.com" contains "acme.com".
    // Equality on the extracted domain is the actual rule.
    const company = companiesAtDomain.find(
      (candidate) =>
        isDefined(candidate.domainName?.primaryLinkUrl) &&
        extractDomainFromLink(candidate.domainName.primaryLinkUrl) === domain,
    );

    if (!isDefined(company)) {
      return { kind: 'NONE' };
    }

    const peopleAtCompany = await personRepository.find({
      where: { companyId: company.id },
    });

    const normalizedIncomingName = normalizePersonDisplayName(displayName);

    const nameMatch = peopleAtCompany.find((person) => {
      const personDisplayName = [person.name?.firstName, person.name?.lastName]
        .filter(isDefined)
        .join(' ');

      return (
        normalizePersonDisplayName(personDisplayName) === normalizedIncomingName
      );
    });

    if (!isDefined(nameMatch)) {
      return { kind: 'NONE' };
    }

    return {
      kind: 'CANDIDATE',
      recordId: nameMatch.id,
      explanation: `"${displayName}" matches an existing person's name at company domain ${domain}, but arrived from a different email address (${email}). Confirm before merging.`,
    };
  }

  // Company identity has one real signal (domain) — no name-based CANDIDATE
  // tier, unlike person matching. A domain either matches or it doesn't.
  async resolveCompany(params: {
    workspaceId: string;
    domain: string;
  }): Promise<IdentityMatch> {
    const { workspaceId, domain } = params;

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      () => this.resolveCompanyInContext(workspaceId, domain),
      buildSystemAuthContext(workspaceId),
      { lite: true },
    );
  }

  private async resolveCompanyInContext(
    workspaceId: string,
    domain: string,
  ): Promise<IdentityMatch> {
    const companyRepository =
      await this.globalWorkspaceOrmManager.getRepository<CompanyWorkspaceEntity>(
        workspaceId,
        'company',
        { shouldBypassPermissionChecks: true },
      );

    const companiesAtDomain = await companyRepository.find({
      where: { domainName: { primaryLinkUrl: ILike(`%${domain}%`) } },
    });

    // ILike is only a cheap prefilter: "notacme.com" contains "acme.com".
    // Equality on the extracted domain is the actual rule, and it has to be
    // applied across every prefiltered row — a findOne would let a decoy row
    // that merely contains the domain hide the real match, and a real company
    // would then be re-created as a duplicate.
    const company = companiesAtDomain.find(
      (candidate) =>
        isDefined(candidate.domainName?.primaryLinkUrl) &&
        extractDomainFromLink(candidate.domainName.primaryLinkUrl) === domain,
    );

    if (!isDefined(company)) {
      return { kind: 'NONE' };
    }

    return {
      kind: 'EXACT',
      recordId: company.id,
      matchedOn: `domain ${domain} matches this company's domainName`,
    };
  }
}
