import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { FieldActorSource } from 'twenty-shared/types';

import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { KeyValuePairService } from 'src/engine/core-modules/key-value-pair/key-value-pair.service';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { type ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { ContactAutoCreatePolicyService } from 'src/modules/contact-creation-manager/services/contact-auto-create-policy.service';
import { CreateCompanyAndPersonService } from 'src/modules/contact-creation-manager/services/create-company-and-contact.service';
import { CreateCompanyService } from 'src/modules/contact-creation-manager/services/create-company.service';
import { CreatePersonService } from 'src/modules/contact-creation-manager/services/create-person.service';
import { type Contact } from 'src/modules/contact-creation-manager/types/contact.type';
import { IngestionSuppressionService } from 'src/modules/ingestion-noise-filter/services/ingestion-suppression.service';

// The gap this closes: an ingested message from noreply@ a machine domain used
// to mint a Person (and a Company from its work domain). It must now create
// nothing at all. The suppression service here is the REAL one over an empty
// tenant list, so only the built-in layers are doing the work.
describe('CreateCompanyAndPersonService — inbound noise filter', () => {
  let service: CreateCompanyAndPersonService;

  const createCompanyService = {
    createOrRestoreCompanies: jest.fn().mockResolvedValue({}),
  };
  const createPersonService = {
    createPeople: jest.fn().mockResolvedValue({}),
    restorePeople: jest.fn().mockResolvedValue({}),
    enrichPeopleNames: jest.fn().mockResolvedValue(undefined),
  };
  const keyValuePairService = { get: jest.fn().mockResolvedValue([]) };

  const personQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orWhere: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    withDeleted: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  };

  const globalWorkspaceOrmManager = {
    executeInWorkspaceContext: jest.fn(
      async (callback: () => Promise<unknown>) => callback(),
    ),
    getRepository: jest.fn().mockResolvedValue({
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue(personQueryBuilder),
    }),
  };

  const connectedAccount = {
    id: 'connected-account-1',
    handle: 'me@ourcompany.com',
    handleAliases: [],
    provider: 'google',
    accountOwner: { id: 'workspace-member-1' },
  } as unknown as ConnectedAccountEntity;

  beforeEach(async () => {
    jest.clearAllMocks();
    keyValuePairService.get.mockResolvedValue([]);
    personQueryBuilder.getMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateCompanyAndPersonService,
        { provide: CreateCompanyService, useValue: createCompanyService },
        { provide: CreatePersonService, useValue: createPersonService },
        {
          provide: GlobalWorkspaceOrmManager,
          useValue: globalWorkspaceOrmManager,
        },
        { provide: ExceptionHandlerService, useValue: {} },
        IngestionSuppressionService,
        { provide: KeyValuePairService, useValue: keyValuePairService },
        { provide: ContactAutoCreatePolicyService, useValue: {} },
        {
          provide: getRepositoryToken(UserWorkspaceEntity),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(WorkspaceEntity),
          useValue: {
            findOne: jest.fn().mockResolvedValue({
              id: 'workspace-1',
              isInternalMessagesImportEnabled: false,
            }),
          },
        },
      ],
    }).compile();

    service = module.get(CreateCompanyAndPersonService);
  });

  const run = (contacts: Contact[]) =>
    service.createCompaniesAndPeople(
      connectedAccount,
      contacts,
      'workspace-1',
      FieldActorSource.EMAIL,
      null,
    );

  it('should create nothing for noreply@ a machine domain', async () => {
    const result = await run([
      {
        handle: 'noreply@calendar.google.com',
        displayName: 'Google Calendar',
      },
    ]);

    expect(result).toEqual([]);
    expect(createCompanyService.createOrRestoreCompanies).not.toHaveBeenCalled();
    expect(createPersonService.createPeople).not.toHaveBeenCalled();
    expect(createPersonService.restorePeople).not.toHaveBeenCalled();
    // Nothing is even looked up: no Person exists to anchor a proposal to.
    expect(personQueryBuilder.getMany).not.toHaveBeenCalled();
  });

  it.each([
    'mailer-daemon@vendor.com',
    'notifications@vendor.com',
    'bounces+42@vendor.com',
    'c_0123456789abcdef0123456789@resource.calendar.google.com',
  ])('should create nothing for the noise handle %s', async (handle) => {
    await run([{ handle, displayName: '' }]);

    expect(createPersonService.createPeople).not.toHaveBeenCalled();
    expect(createCompanyService.createOrRestoreCompanies).not.toHaveBeenCalled();
  });

  it('should still create a real person on the same batch', async () => {
    await run([
      { handle: 'noreply@calendar.google.com', displayName: 'Calendar' },
      { handle: 'jane.doe@vendor.com', displayName: 'Jane Doe' },
    ]);

    expect(createPersonService.createPeople).toHaveBeenCalledTimes(1);

    const [peopleToCreate] = createPersonService.createPeople.mock.calls[0];

    expect(peopleToCreate).toHaveLength(1);
    expect(peopleToCreate[0].emails.primaryEmail).toBe('jane.doe@vendor.com');
  });

  it('should suppress a handle the tenant added to the suppression list', async () => {
    keyValuePairService.get.mockResolvedValue([
      { value: { suppressedDomains: ['vendor.com'], suppressedEmails: [] } },
    ]);

    await run([{ handle: 'jane.doe@vendor.com', displayName: 'Jane Doe' }]);

    expect(createPersonService.createPeople).not.toHaveBeenCalled();
  });
});
