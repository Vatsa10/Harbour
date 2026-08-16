import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isNonEmptyString, isNull } from '@sniptt/guards';
import chunk from 'lodash.chunk';
import compact from 'lodash.compact';
import {
  ConnectedAccountProvider,
  FieldActorSource,
  type FullNameMetadata,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { type DeepPartial, type Repository } from 'typeorm';
import { v4 } from 'uuid';

import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { type ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { CONTACTS_CREATION_BATCH_SIZE } from 'src/modules/contact-creation-manager/constants/contacts-creation-batch-size.constant';
import { ContactAutoCreatePolicyService } from 'src/modules/contact-creation-manager/services/contact-auto-create-policy.service';
import { CreateCompanyService } from 'src/modules/contact-creation-manager/services/create-company.service';
import { CreatePersonService } from 'src/modules/contact-creation-manager/services/create-person.service';
import { type Contact } from 'src/modules/contact-creation-manager/types/contact.type';
import { filterOutContactsThatBelongToSelfOrWorkspaceMembers } from 'src/modules/contact-creation-manager/utils/filter-out-contacts-that-belong-to-self-or-workspace-members.util';
import { getDomainNameFromHandle } from 'src/modules/contact-creation-manager/utils/get-domain-name-from-handle.util';
import { getFirstNameAndLastNameFromHandleAndDisplayName } from 'src/modules/contact-creation-manager/utils/get-first-name-and-last-name-from-handle-and-display-name.util';
import { getUniqueContactsAndHandles } from 'src/modules/contact-creation-manager/utils/get-unique-contacts-and-handles.util';
import { IngestionSuppressionService } from 'src/modules/ingestion-noise-filter/services/ingestion-suppression.service';
import { addPersonEmailFiltersToQueryBuilder } from 'src/modules/match-participant/utils/add-person-email-filters-to-query-builder';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';
import { computeDisplayName } from 'src/utils/compute-display-name';
import { isWorkDomain, isWorkEmail } from 'src/utils/is-work-email';

@Injectable()
export class CreateCompanyAndPersonService {
  constructor(
    private readonly createPersonService: CreatePersonService,
    private readonly createCompaniesService: CreateCompanyService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly exceptionHandlerService: ExceptionHandlerService,
    private readonly ingestionSuppressionService: IngestionSuppressionService,
    private readonly contactAutoCreatePolicyService: ContactAutoCreatePolicyService,
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
  ) {}

  async createCompaniesAndPeople(
    connectedAccount: ConnectedAccountEntity,
    contactsToCreate: Contact[],
    workspaceId: string,
    source: FieldActorSource,
    accountOwner: WorkspaceMemberWorkspaceEntity | null,
    // Rules 1 and 2 of the auto-create policy. Handles in this set failed the
    // reciprocity gate: they may enrich a Person that already exists, but may
    // never mint a Person, restore a soft-deleted one, or mint a Company. A
    // gated handle with no existing Person therefore produces nothing at all —
    // "no company matched and no contact matched, drop the message entirely".
    enrichOnlyHandles: Set<string> = new Set<string>(),
  ): Promise<DeepPartial<PersonWorkspaceEntity>[]> {
    if (!contactsToCreate || contactsToCreate.length === 0) {
      return [];
    }

    const authContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const personRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            workspaceId,
            PersonWorkspaceEntity,
            {
              shouldBypassPermissionChecks: true,
            },
          );

        const workspaceMemberRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            workspaceId,
            WorkspaceMemberWorkspaceEntity,
            { shouldBypassPermissionChecks: true },
          );

        const workspaceMembers = await workspaceMemberRepository.find();

        const workspace = await this.workspaceRepository.findOne({
          where: { id: workspaceId },
          select: ['id', 'isInternalMessagesImportEnabled'],
        });

        const peopleToCreateFromOtherCompanies =
          filterOutContactsThatBelongToSelfOrWorkspaceMembers(
            contactsToCreate,
            connectedAccount,
            workspaceMembers,
            workspace?.isInternalMessagesImportEnabled ?? false,
          );

        // Inbound noise filter. This runs before any Person or Company is
        // created, and therefore before structured extraction can anchor a
        // proposal to one: a suppressed participant produces neither a record
        // nor a proposal.
        const noiseFilter =
          await this.ingestionSuppressionService.buildFilter(workspaceId);

        const notSuppressedContacts = peopleToCreateFromOtherCompanies.filter(
          (contact) => !noiseFilter.isSuppressed(contact.handle),
        );

        const { uniqueContacts, uniqueHandles } = getUniqueContactsAndHandles(
          notSuppressedContacts,
        );

        if (uniqueHandles.length === 0) {
          return [];
        }

        const queryBuilder = addPersonEmailFiltersToQueryBuilder({
          queryBuilder: personRepository.createQueryBuilder('person'),
          emails: uniqueHandles,
        });

        const alreadyCreatedPeople = await queryBuilder
          .orderBy('person.createdAt', 'ASC')
          .withDeleted()
          .getMany();

        const {
          contactsThatNeedPersonCreate,
          contactsThatNeedPersonRestore,
          peopleToEnrichNames,
          workDomainNamesToCreate,
          shouldCreateOrRestorePeopleByHandleMap,
        } =
          this.computeContactsThatNeedPersonCreateAndRestoreAndWorkDomainNamesToCreate(
            uniqueContacts,
            alreadyCreatedPeople,
            source,
            connectedAccount,
            accountOwner,
            enrichOnlyHandles,
          );

        const companiesMap =
          await this.createCompaniesService.createOrRestoreCompanies(
            workDomainNamesToCreate,
            workspaceId,
          );

        const peopleToCreate = this.formatPeopleToCreateFromContacts({
          contactsToCreate: contactsThatNeedPersonCreate,
          createdBy: {
            source: source,
            workspaceMember: accountOwner,
            context: {
              provider: connectedAccount.provider,
            },
          },
          companiesMap,
        });

        const createdPeople = await this.createPersonService.createPeople(
          peopleToCreate,
          workspaceId,
        );

        const peopleToRestore = this.formatPeopleToRestoreFromContacts({
          contactsToRestore: contactsThatNeedPersonRestore,
          companiesMap,
          shouldCreateOrRestorePeopleByHandleMap,
        });

        const restoredPeople = await this.createPersonService.restorePeople(
          peopleToRestore,
          workspaceId,
        );

        await this.createPersonService.enrichPeopleNames(
          peopleToEnrichNames,
          workspaceId,
        );

        return { ...createdPeople, ...restoredPeople };
      },
      authContext,
    );
  }

  async createCompaniesAndPeopleAndUpdateParticipants(
    connectedAccount: ConnectedAccountEntity,
    contactsToCreate: Contact[],
    workspaceId: string,
    source: FieldActorSource,
  ) {
    const contactsBatches = chunk(
      contactsToCreate,
      CONTACTS_CREATION_BATCH_SIZE,
    );

    const authContext = buildSystemAuthContext(workspaceId);

    const accountOwner =
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const userWorkspace = await this.userWorkspaceRepository.findOne({
            where: { id: connectedAccount.userWorkspaceId },
          });

          if (!userWorkspace) {
            throw new Error(
              `UserWorkspace with id ${connectedAccount.userWorkspaceId} not found`,
            );
          }

          const workspaceMemberRepository =
            await this.globalWorkspaceOrmManager.getRepository(
              workspaceId,
              WorkspaceMemberWorkspaceEntity,
              { shouldBypassPermissionChecks: true },
            );

          return workspaceMemberRepository.findOne({
            where: { userId: userWorkspace.userId },
          });
        },
        authContext,
      );

    // Rule 3: the reciprocity verdict is resolved once for the whole run,
    // per thread, and every batch and every message inherits it. Resolving it
    // inside the batch loop would let one thread receive two verdicts.
    const { enrichOnlyHandles } =
      await this.contactAutoCreatePolicyService.evaluate({
        workspaceId,
        connectedAccount,
        contacts: contactsToCreate,
      });

    for (const contactsBatch of contactsBatches) {
      try {
        await this.createCompaniesAndPeople(
          connectedAccount,
          contactsBatch,
          workspaceId,
          source,
          accountOwner,
          enrichOnlyHandles,
        );
      } catch (error) {
        this.exceptionHandlerService.captureExceptions([error], {
          workspace: {
            id: workspaceId,
          },
        });
      }
    }
  }

  computeContactsThatNeedPersonCreateAndRestoreAndWorkDomainNamesToCreate(
    uniqueContacts: Contact[],
    alreadyCreatedPeople: PersonWorkspaceEntity[],
    source: FieldActorSource,
    connectedAccount: ConnectedAccountEntity,
    accountOwner: WorkspaceMemberWorkspaceEntity | null,
    enrichOnlyHandles: Set<string> = new Set<string>(),
  ) {
    const shouldCreateOrRestorePeopleByHandleMap = new Map<
      string,
      { existingPerson: PersonWorkspaceEntity }
    >();

    for (const contact of uniqueContacts) {
      if (!contact.handle.includes('@')) {
        continue;
      }

      const existingPersonOnPrimaryEmail = alreadyCreatedPeople.find(
        (person) => {
          return (
            isNonEmptyString(person.emails?.primaryEmail) &&
            person.emails.primaryEmail.toLowerCase() ===
              contact.handle.toLowerCase()
          );
        },
      );

      if (isDefined(existingPersonOnPrimaryEmail)) {
        shouldCreateOrRestorePeopleByHandleMap.set(
          contact.handle.toLowerCase(),
          {
            existingPerson: existingPersonOnPrimaryEmail,
          },
        );
        continue;
      }

      const existingPersonOnAdditionalEmails = alreadyCreatedPeople.find(
        (person) => {
          return (
            Array.isArray(person.emails?.additionalEmails) &&
            person.emails.additionalEmails.some(
              (email) => email.toLowerCase() === contact.handle.toLowerCase(),
            )
          );
        },
      );

      if (!isDefined(existingPersonOnAdditionalEmails)) continue;

      shouldCreateOrRestorePeopleByHandleMap.set(contact.handle.toLowerCase(), {
        existingPerson: existingPersonOnAdditionalEmails,
      });
    }

    // Rule 1 (reciprocity gate) and rule 2 (no match, no row): a gated handle
    // never reaches the create list. If it matched no existing Person it is in
    // no list at all, so the message contributes nothing — no orphan record.
    // If it did match, only computePeopleToEnrichNames below still sees it.
    const contactsThatNeedPersonCreate = uniqueContacts.filter(
      (contact) =>
        !shouldCreateOrRestorePeopleByHandleMap.has(
          contact.handle.toLowerCase(),
        ) && !enrichOnlyHandles.has(contact.handle.toLowerCase()),
    );

    const contactsThatNeedPersonRestore = uniqueContacts.filter((contact) => {
      // Restoring a soft-deleted Person re-mints a record a human deleted —
      // squarely a create for the purposes of the gate.
      if (enrichOnlyHandles.has(contact.handle.toLowerCase())) {
        return false;
      }

      const existingPerson = shouldCreateOrRestorePeopleByHandleMap.get(
        contact.handle.toLowerCase(),
      )?.existingPerson;

      if (!isDefined(existingPerson)) {
        return false;
      }

      return !isNull(existingPerson.deletedAt);
    });

    const peopleToEnrichNames = this.computePeopleToEnrichNames(
      uniqueContacts,
      shouldCreateOrRestorePeopleByHandleMap,
    );

    const workDomainNamesToCreate = compact(
      [...contactsThatNeedPersonCreate, ...contactsThatNeedPersonRestore]
        .map((contact) => {
          const companyDomainName = isWorkEmail(contact.handle)
            ? getDomainNameFromHandle(contact.handle)
            : undefined;

          if (!isDefined(companyDomainName) || !isWorkDomain(companyDomainName))
            return undefined;

          return {
            domainName: companyDomainName,
            createdBySource: source,
            createdByWorkspaceMember: accountOwner,
            createdByContext: {
              provider: connectedAccount.provider,
            },
          };
        })
        .filter(isDefined),
    );

    return {
      contactsThatNeedPersonCreate,
      contactsThatNeedPersonRestore,
      peopleToEnrichNames,
      workDomainNamesToCreate,
      shouldCreateOrRestorePeopleByHandleMap,
    };
  }

  // Stages per-personId name enrichments for existing People auto-created via
  // CALENDAR or EMAIL. Empty fields are filled from new sources (first
  // non-empty value wins across multiple contacts mapping to the same Person);
  // populated fields are never overwritten.
  private computePeopleToEnrichNames(
    uniqueContacts: Contact[],
    shouldCreateOrRestorePeopleByHandleMap: Map<
      string,
      { existingPerson: PersonWorkspaceEntity }
    >,
  ): { personId: string; name: FullNameMetadata }[] {
    const enrichmentByPersonId = new Map<
      string,
      { firstName: string; lastName: string }
    >();

    for (const contact of uniqueContacts) {
      const existingPerson = shouldCreateOrRestorePeopleByHandleMap.get(
        contact.handle.toLowerCase(),
      )?.existingPerson;

      if (!isDefined(existingPerson)) {
        continue;
      }

      // Soft-deleted matches are restored earlier in the same job, so the
      // enrichment UPDATE runs against an un-deleted row.
      const existingSource = existingPerson.createdBy?.source;

      if (
        existingSource !== FieldActorSource.CALENDAR &&
        existingSource !== FieldActorSource.EMAIL
      ) {
        continue;
      }

      const staged = enrichmentByPersonId.get(existingPerson.id);
      const currentFirstName =
        staged?.firstName ?? existingPerson.name?.firstName ?? '';
      const currentLastName =
        staged?.lastName ?? existingPerson.name?.lastName ?? '';
      const firstNameIsEmpty = !isNonEmptyString(currentFirstName);
      const lastNameIsEmpty = !isNonEmptyString(currentLastName);

      if (!firstNameIsEmpty && !lastNameIsEmpty) {
        continue;
      }

      const { firstName: parsedFirstName, lastName: parsedLastName } =
        getFirstNameAndLastNameFromHandleAndDisplayName(
          contact.handle,
          contact.displayName,
        );

      const enrichedFirstName =
        firstNameIsEmpty && isNonEmptyString(parsedFirstName)
          ? parsedFirstName
          : currentFirstName;
      const enrichedLastName =
        lastNameIsEmpty && isNonEmptyString(parsedLastName)
          ? parsedLastName
          : currentLastName;

      if (
        enrichedFirstName === currentFirstName &&
        enrichedLastName === currentLastName
      ) {
        continue;
      }

      enrichmentByPersonId.set(existingPerson.id, {
        firstName: enrichedFirstName,
        lastName: enrichedLastName,
      });
    }

    return Array.from(enrichmentByPersonId.entries()).map(
      ([personId, name]) => ({ personId, name }),
    );
  }

  formatPeopleToCreateFromContacts({
    contactsToCreate,
    createdBy,
    companiesMap,
  }: {
    contactsToCreate: {
      handle: string;
      displayName: string;
    }[];
    createdBy: {
      source: FieldActorSource;
      workspaceMember?: WorkspaceMemberWorkspaceEntity | null;
      context: {
        provider: ConnectedAccountProvider;
      };
    };
    companiesMap: Record<string, string>;
  }): Partial<PersonWorkspaceEntity>[] {
    return contactsToCreate.map((contact) => {
      const id = v4();

      const { handle, displayName } = contact;

      const { firstName, lastName } =
        getFirstNameAndLastNameFromHandleAndDisplayName(handle, displayName);
      const createdByName = computeDisplayName(createdBy.workspaceMember?.name);

      const companyId = companiesMap[getDomainNameFromHandle(handle)];

      return {
        id,
        emails: {
          primaryEmail: handle.toLowerCase(),
          additionalEmails: null,
        },
        name: {
          firstName,
          lastName,
        },
        companyId,
        createdBy: {
          source: createdBy.source,
          workspaceMemberId: createdBy.workspaceMember?.id ?? null,
          name: createdByName,
          context: createdBy.context,
        },
      };
    });
  }

  formatPeopleToRestoreFromContacts({
    contactsToRestore,
    companiesMap,
    shouldCreateOrRestorePeopleByHandleMap,
  }: {
    contactsToRestore: {
      handle: string;
      displayName: string;
    }[];
    companiesMap: Record<string, string>;
    shouldCreateOrRestorePeopleByHandleMap: Map<
      string,
      { existingPerson: PersonWorkspaceEntity | undefined }
    >;
  }): { personId: string; companyId: string | undefined }[] {
    const peopleToRestore = [];

    for (const contact of contactsToRestore) {
      const { handle } = contact;

      const existingPerson = shouldCreateOrRestorePeopleByHandleMap.get(
        handle.toLowerCase(),
      )?.existingPerson;

      if (!isDefined(existingPerson) || isNull(existingPerson.deletedAt))
        continue;

      const companyId = companiesMap[getDomainNameFromHandle(handle)];

      peopleToRestore.push({
        personId: existingPerson.id,
        companyId,
      });
    }

    return peopleToRestore;
  }
}
