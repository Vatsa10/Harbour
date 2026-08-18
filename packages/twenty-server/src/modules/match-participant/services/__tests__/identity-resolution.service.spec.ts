import { Test, type TestingModule } from '@nestjs/testing';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { IdentityResolutionService } from 'src/modules/match-participant/services/identity-resolution.service';

describe('IdentityResolutionService', () => {
  let service: IdentityResolutionService;

  // The real addPersonEmailFiltersToQueryBuilder runs against this double, so
  // every builder method it calls must exist — the SQL it emits is covered by
  // that util's own snapshot spec.
  const personQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orWhere: jest.fn().mockReturnThis(),
    withDeleted: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };
  const personRepository = {
    createQueryBuilder: jest.fn(() => personQueryBuilder),
    find: jest.fn(),
  };
  const companyRepository = { find: jest.fn(), findOne: jest.fn() };

  const globalWorkspaceOrmManager = {
    getRepository: jest.fn((_workspaceId: string, entity: unknown) => {
      return entity === 'company' ? companyRepository : personRepository;
    }),
    // Pass through: the real manager establishes the ORM workspace context and
    // then runs the callback, which is what the service under test relies on.
    executeInWorkspaceContext: jest.fn(<T,>(fn: () => T | Promise<T>) => fn()),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    personQueryBuilder.getMany.mockResolvedValue([]);
    for (const method of [
      personQueryBuilder.select,
      personQueryBuilder.where,
      personQueryBuilder.andWhere,
      personQueryBuilder.orWhere,
      personQueryBuilder.withDeleted,
      personQueryBuilder.orderBy,
    ]) {
      method.mockReturnValue(personQueryBuilder);
    }
    personRepository.createQueryBuilder.mockReturnValue(personQueryBuilder);
    personRepository.find.mockResolvedValue([]);
    companyRepository.find.mockResolvedValue([]);
    companyRepository.findOne.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdentityResolutionService,
        {
          provide: GlobalWorkspaceOrmManager,
          useValue: globalWorkspaceOrmManager,
        },
      ],
    }).compile();

    service = module.get<IdentityResolutionService>(IdentityResolutionService);
  });

  describe('resolvePerson', () => {
    it('should return EXACT when the email matches an existing person', async () => {
      personQueryBuilder.getMany.mockResolvedValue([
        {
          id: 'person-1',
          emails: { primaryEmail: 'jane@acme.com', additionalEmails: [] },
          name: { firstName: 'Jane', lastName: 'Doe' },
          companyId: 'company-1',
        },
      ]);

      const match = await service.resolvePerson({
        workspaceId: 'workspace-1',
        email: 'jane@acme.com',
      });

      expect(match).toEqual({
        kind: 'EXACT',
        recordId: 'person-1',
        matchedOn: expect.stringContaining('email'),
      });
    });

    it('should return EXACT on an additional email, ignoring a non-matching row returned by the superset SQL filter', async () => {
      // The email query builder is a superset (jsonb containment + lowercased
      // IN). If the service trusted row order instead of re-applying the exact
      // rule, this would return person-noise.
      personQueryBuilder.getMany.mockResolvedValue([
        {
          id: 'person-noise',
          emails: { primaryEmail: 'other@acme.com', additionalEmails: [] },
        },
        {
          id: 'person-2',
          emails: {
            primaryEmail: 'j.doe@acme.com',
            additionalEmails: ['Jane@ACME.com'],
          },
        },
      ]);

      const match = await service.resolvePerson({
        workspaceId: 'workspace-1',
        email: 'jane@acme.com',
      });

      expect(match).toEqual({
        kind: 'EXACT',
        recordId: 'person-2',
        matchedOn: expect.stringContaining('email'),
      });
    });

    it('should return NONE when there is no email match and no displayName to compare', async () => {
      const match = await service.resolvePerson({
        workspaceId: 'workspace-1',
        email: 'unknown@acme.com',
      });

      expect(match).toEqual({ kind: 'NONE' });
    });

    it('should return CANDIDATE when the domain and the name both match an existing person under a different email', async () => {
      companyRepository.find.mockResolvedValue([
        { id: 'company-1', domainName: { primaryLinkUrl: 'https://acme.com' } },
      ]);
      personRepository.find.mockResolvedValue([
        {
          id: 'person-1',
          name: { firstName: 'Jane', lastName: 'Doe' },
          companyId: 'company-1',
        },
      ]);

      const match = await service.resolvePerson({
        workspaceId: 'workspace-1',
        email: 'jane.doe@acme.com',
        displayName: 'Jane Doe',
      });

      expect(match).toEqual({
        kind: 'CANDIDATE',
        recordId: 'person-1',
        explanation: expect.stringContaining('acme.com'),
      });
    });

    it('should return NONE when the domain matches but no person at that company has a matching name', async () => {
      companyRepository.find.mockResolvedValue([
        { id: 'company-1', domainName: { primaryLinkUrl: 'https://acme.com' } },
      ]);
      personRepository.find.mockResolvedValue([
        {
          id: 'person-1',
          name: { firstName: 'John', lastName: 'Smith' },
          companyId: 'company-1',
        },
      ]);

      const match = await service.resolvePerson({
        workspaceId: 'workspace-1',
        email: 'jane.doe@acme.com',
        displayName: 'Jane Doe',
      });

      expect(match).toEqual({ kind: 'NONE' });
    });

    it('should return NONE when the domain has no matching company at all', async () => {
      companyRepository.find.mockResolvedValue([]);

      const match = await service.resolvePerson({
        workspaceId: 'workspace-1',
        email: 'jane.doe@acme.com',
        displayName: 'Jane Doe',
      });

      expect(match).toEqual({ kind: 'NONE' });
    });

    it('should not treat a company whose domain merely contains the email domain as a match', async () => {
      // ILike '%acme.com%' also returns notacme.com — a suffix collision is a
      // different company, and linking them would pollute the workspace.
      companyRepository.find.mockResolvedValue([
        {
          id: 'company-other',
          domainName: { primaryLinkUrl: 'https://notacme.com' },
        },
      ]);
      personRepository.find.mockResolvedValue([
        {
          id: 'person-1',
          name: { firstName: 'Jane', lastName: 'Doe' },
          companyId: 'company-other',
        },
      ]);

      const match = await service.resolvePerson({
        workspaceId: 'workspace-1',
        email: 'jane.doe@acme.com',
        displayName: 'Jane Doe',
      });

      expect(match).toEqual({ kind: 'NONE' });
      expect(personRepository.find).not.toHaveBeenCalled();
    });

    it('should return CANDIDATE via the relationship lane when a related company has a matching name but the email domain does not match', async () => {
      // Email domain lookup returns nothing (no company at that domain) —
      // the relationship signal is the only path to a match here.
      companyRepository.find.mockResolvedValue([]);
      personRepository.find.mockResolvedValue([
        {
          id: 'person-1',
          name: { firstName: 'Jane', lastName: 'Doe' },
          companyId: 'company-related',
        },
      ]);

      const match = await service.resolvePerson({
        workspaceId: 'workspace-1',
        email: 'jane.doe@personal-email.com',
        displayName: 'Jane Doe',
        relatedCompanyIds: ['company-related'],
      });

      expect(match).toEqual({
        kind: 'CANDIDATE',
        recordId: 'person-1',
        explanation: expect.stringContaining('already linked'),
      });
      expect(personRepository.find).toHaveBeenCalledWith({
        where: { companyId: 'company-related' },
      });
    });

    it('should return NONE when a related company has no person with a matching name', async () => {
      companyRepository.find.mockResolvedValue([]);
      personRepository.find.mockResolvedValue([
        {
          id: 'person-1',
          name: { firstName: 'John', lastName: 'Smith' },
          companyId: 'company-related',
        },
      ]);

      const match = await service.resolvePerson({
        workspaceId: 'workspace-1',
        email: 'jane.doe@personal-email.com',
        displayName: 'Jane Doe',
        relatedCompanyIds: ['company-related'],
      });

      expect(match).toEqual({ kind: 'NONE' });
    });

    it('should prefer the domain lane over the relationship lane when both would match', async () => {
      companyRepository.find.mockResolvedValue([
        { id: 'company-1', domainName: { primaryLinkUrl: 'https://acme.com' } },
      ]);
      personRepository.find.mockResolvedValue([
        {
          id: 'person-domain',
          name: { firstName: 'Jane', lastName: 'Doe' },
          companyId: 'company-1',
        },
      ]);

      const match = await service.resolvePerson({
        workspaceId: 'workspace-1',
        email: 'jane.doe@acme.com',
        displayName: 'Jane Doe',
        relatedCompanyIds: ['company-unrelated'],
      });

      expect(match).toEqual({
        kind: 'CANDIDATE',
        recordId: 'person-domain',
        explanation: expect.stringContaining('acme.com'),
      });
    });

    it('should not consult relatedCompanyIds when there is no displayName to match on', async () => {
      const match = await service.resolvePerson({
        workspaceId: 'workspace-1',
        email: 'jane.doe@personal-email.com',
        relatedCompanyIds: ['company-related'],
      });

      expect(match).toEqual({ kind: 'NONE' });
      expect(personRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('resolveCompany', () => {
    it('should return EXACT when the domain matches an existing company', async () => {
      companyRepository.find.mockResolvedValue([
        {
          id: 'company-1',
          domainName: { primaryLinkUrl: 'https://acme.com' },
        },
      ]);

      const match = await service.resolveCompany({
        workspaceId: 'workspace-1',
        domain: 'acme.com',
      });

      expect(match).toEqual({
        kind: 'EXACT',
        recordId: 'company-1',
        matchedOn: expect.stringContaining('domain'),
      });
    });

    it('should return NONE when no company matches the domain', async () => {
      companyRepository.find.mockResolvedValue([]);

      const match = await service.resolveCompany({
        workspaceId: 'workspace-1',
        domain: 'unknown.com',
      });

      expect(match).toEqual({ kind: 'NONE' });
    });

    it('should return NONE for a suffix collision returned by the ILike prefilter', async () => {
      companyRepository.find.mockResolvedValue([
        {
          id: 'company-other',
          domainName: { primaryLinkUrl: 'https://notacme.com/careers' },
        },
      ]);

      const match = await service.resolveCompany({
        workspaceId: 'workspace-1',
        domain: 'acme.com',
      });

      expect(match).toEqual({ kind: 'NONE' });
    });

    it('should find the real company even when a decoy row sorts first', async () => {
      // The ILike prefilter returns both; a findOne would have taken the
      // decoy, reported NONE, and let the importer create a duplicate.
      companyRepository.find.mockResolvedValue([
        {
          id: 'company-decoy',
          domainName: { primaryLinkUrl: 'https://notacme.com/careers' },
        },
        {
          id: 'company-1',
          domainName: { primaryLinkUrl: 'https://acme.com' },
        },
      ]);

      const match = await service.resolveCompany({
        workspaceId: 'workspace-1',
        domain: 'acme.com',
      });

      expect(match).toEqual({
        kind: 'EXACT',
        recordId: 'company-1',
        matchedOn: expect.stringContaining('domain'),
      });
    });
  });
});
