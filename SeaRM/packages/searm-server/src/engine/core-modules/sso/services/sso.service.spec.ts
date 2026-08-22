import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

// xml-crypto is a transitive dependency of @node-saml/node-saml (already in
// package.json). Used here, test-only, to build a genuinely signed SAML
// Response fixture so the signature-validation tests exercise real XML-DSig
// verification rather than a mocked-out boolean.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SignedXml } = require('xml-crypto');
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Repository } from 'typeorm';

import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';
import { SSOService } from 'src/engine/core-modules/sso/services/sso.service';
import { SSOException } from 'src/engine/core-modules/sso/sso.exception';
import {
  IdentityProviderType,
  SSOIdentityProviderStatus,
  WorkspaceSSOIdentityProviderEntity,
} from 'src/engine/core-modules/sso/workspace-sso-identity-provider.entity';

const WORKSPACE_ID = 'workspace-123';
const IDENTITY_PROVIDER_ID = 'provider-123';
const ISSUER = 'https://idp.example.com';
const SP_AUDIENCE = `http://localhost:3000/sso/saml/${WORKSPACE_ID}/metadata`;
const RECIPIENT = `http://localhost:3000/sso/${WORKSPACE_ID}/${IDENTITY_PROVIDER_ID}/callback`;

// node-saml requires idpCert to be a real X.509 certificate PEM (it labels
// and parses it as "CERTIFICATE", not a bare public key) — matching what a
// real IdP hands over and what IsX509Certificate validates at config time.
// Node's `crypto` module has no self-signed-certificate generator, and this
// task should not add a new npm dependency just for a test fixture, so this
// self-signs via the `openssl` CLI (present on this dev host and on
// standard Linux CI images) into a throwaway temp directory.
function generateSelfSignedCert(): { privateKeyPem: string; certPem: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sso-saml-test-'));
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');

  try {
    execFileSync('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      '1',
      '-nodes',
      '-subj',
      '/CN=test-idp.example.com',
    ]);

    return {
      privateKeyPem: readFileSync(keyPath, 'utf8'),
      certPem: readFileSync(certPath, 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function buildSignedSamlResponseXml(options: {
  privateKeyPem: string;
  notBefore: string;
  notOnOrAfter: string;
  audience?: string;
  issuer?: string;
  tamper?: boolean;
}): string {
  const assertionId = '_assertion-' + Math.random().toString(16).slice(2);
  const responseId = '_response-' + Math.random().toString(16).slice(2);
  const now = new Date().toISOString();
  const issuer = options.issuer ?? ISSUER;
  const audience = options.audience ?? SP_AUDIENCE;

  const assertionXml =
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" Version="2.0" IssueInstant="${now}">` +
    `<saml:Issuer>${issuer}</saml:Issuer>` +
    `<saml:Subject>` +
    `<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">user@example.com</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
    `<saml:SubjectConfirmationData Recipient="${RECIPIENT}" NotOnOrAfter="${options.notOnOrAfter}"/>` +
    `</saml:SubjectConfirmation>` +
    `</saml:Subject>` +
    `<saml:Conditions NotBefore="${options.notBefore}" NotOnOrAfter="${options.notOnOrAfter}">` +
    `<saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction>` +
    `</saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${now}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
    `<saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>user@example.com</saml:AttributeValue></saml:Attribute></saml:AttributeStatement>` +
    `</saml:Assertion>`;

  const sig = new SignedXml({
    privateKey: options.privateKeyPem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });

  sig.addReference({
    xpath: `//*[local-name(.)='Assertion']`,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });

  sig.computeSignature(assertionXml, {
    location: { reference: `//*[local-name(.)='Issuer']`, action: 'after' },
  });

  let signedAssertionXml = sig.getSignedXml();

  if (options.tamper) {
    // Flip the assertion content after signing — the signature no longer
    // matches the digest, so this MUST fail verification.
    signedAssertionXml = signedAssertionXml.replace(
      'user@example.com',
      'attacker@evil.com',
    );
  }

  return (
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="${responseId}" Version="2.0" IssueInstant="${now}" Destination="${RECIPIENT}">` +
    `<saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${issuer}</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    signedAssertionXml +
    `</samlp:Response>`
  );
}

describe('SSOService', () => {
  let service: SSOService;
  let repository: Repository<WorkspaceSSOIdentityProviderEntity>;
  let cacheStorageService: CacheStorageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SSOService,
        {
          provide: getRepositoryToken(WorkspaceSSOIdentityProviderEntity),
          useClass: Repository,
        },
        {
          provide: CacheStorageNamespace.EngineSSO,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SSOService>(SSOService);
    repository = module.get<Repository<WorkspaceSSOIdentityProviderEntity>>(
      getRepositoryToken(WorkspaceSSOIdentityProviderEntity),
    );
    cacheStorageService = module.get<CacheStorageService>(
      CacheStorageNamespace.EngineSSO,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('deleteSSOIdentityProvider', () => {
    it('deletes when the provider exists in the caller-supplied workspace', async () => {
      jest
        .spyOn(repository, 'findOne')
        .mockResolvedValue({ id: IDENTITY_PROVIDER_ID } as WorkspaceSSOIdentityProviderEntity);
      jest.spyOn(repository, 'delete').mockResolvedValue({ raw: [], affected: 1 } as any);

      const result = await service.deleteSSOIdentityProvider(
        IDENTITY_PROVIDER_ID,
        WORKSPACE_ID,
      );

      expect(result).toEqual({ identityProviderId: IDENTITY_PROVIDER_ID });
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: IDENTITY_PROVIDER_ID, workspaceId: WORKSPACE_ID },
      });
    });

    it('throws SSOException when the provider does not exist in that workspace', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(null);

      await expect(
        service.deleteSSOIdentityProvider(IDENTITY_PROVIDER_ID, WORKSPACE_ID),
      ).rejects.toThrow(SSOException);
    });
  });

  describe('getAuthorizationUrlForSSO / findSSOIdentityProviderById — hostile-input scoping', () => {
    it('returns the same generic error whether the id does not exist, belongs to another workspace, or is inactive', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(null);

      const notFound = await service
        .getAuthorizationUrlForSSO(IDENTITY_PROVIDER_ID, { workspaceId: WORKSPACE_ID })
        .catch((e) => e);

      expect(notFound).toBeInstanceOf(SSOException);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: {
          id: IDENTITY_PROVIDER_ID,
          workspaceId: WORKSPACE_ID,
          status: SSOIdentityProviderStatus.Active,
        },
      });
    });

    it('findSSOIdentityProviderById requires an explicit workspaceId and only returns Active providers', async () => {
      const spy = jest.spyOn(repository, 'findOne').mockResolvedValue(null);

      await service.findSSOIdentityProviderById(IDENTITY_PROVIDER_ID, WORKSPACE_ID);

      expect(spy).toHaveBeenCalledWith({
        where: {
          id: IDENTITY_PROVIDER_ID,
          workspaceId: WORKSPACE_ID,
          status: SSOIdentityProviderStatus.Active,
        },
      });
    });
  });

  describe('validateSAMLResponse — RelayState replay protection (SSOService-owned layer)', () => {
    it('rejects a RelayState that has already been consumed', async () => {
      jest
        .spyOn(repository, 'findOne')
        .mockResolvedValue({
          id: IDENTITY_PROVIDER_ID,
          workspaceId: WORKSPACE_ID,
          type: IdentityProviderType.SAML,
          status: SSOIdentityProviderStatus.Active,
          issuer: ISSUER,
          certificate: '-----BEGIN CERTIFICATE-----\nMII=\n-----END CERTIFICATE-----',
          ssoUrl: 'https://idp.example.com/sso',
        } as WorkspaceSSOIdentityProviderEntity);

      // Cache miss == already consumed (or never issued).
      jest.spyOn(cacheStorageService, 'get').mockResolvedValue(undefined);

      await expect(
        service.validateSAMLResponse({
          workspaceId: WORKSPACE_ID,
          identityProviderId: IDENTITY_PROVIDER_ID,
          samlResponseXml: 'irrelevant-because-relaystate-check-runs-first',
          relayState: 'already-used-token',
        }),
      ).rejects.toThrow(SSOException);

      expect(cacheStorageService.del).toHaveBeenCalledWith(
        expect.stringContaining('already-used-token'),
      );
    });
  });

  describe('validateSAMLResponse — signature, audience, and conditions (real XML-DSig)', () => {
    let privateKeyPem: string;
    let certPem: string;

    beforeAll(() => {
      ({ privateKeyPem, certPem } = generateSelfSignedCert());
    });

    const mockActiveProvider = () =>
      jest.spyOn(repository, 'findOne').mockResolvedValue({
        id: IDENTITY_PROVIDER_ID,
        workspaceId: WORKSPACE_ID,
        type: IdentityProviderType.SAML,
        status: SSOIdentityProviderStatus.Active,
        issuer: ISSUER,
        certificate: certPem,
        ssoUrl: 'https://idp.example.com/sso',
      } as WorkspaceSSOIdentityProviderEntity);

    const validWindow = () => {
      const now = Date.now();

      return {
        notBefore: new Date(now - 60_000).toISOString(),
        notOnOrAfter: new Date(now + 60_000).toISOString(),
      };
    };

    it('accepts a genuinely signed, in-window, correctly-audienced assertion', async () => {
      mockActiveProvider();

      const xml = buildSignedSamlResponseXml({
        privateKeyPem,
        ...validWindow(),
      });

      const principal = await service.validateSAMLResponse({
        workspaceId: WORKSPACE_ID,
        identityProviderId: IDENTITY_PROVIDER_ID,
        samlResponseXml: Buffer.from(xml).toString('base64'),
      });

      expect(principal.email).toBe('user@example.com');
      expect(principal.workspaceId).toBe(WORKSPACE_ID);
    });

    it('rejects a tampered assertion (signature no longer matches digest)', async () => {
      mockActiveProvider();

      const xml = buildSignedSamlResponseXml({
        privateKeyPem,
        ...validWindow(),
        tamper: true,
      });

      await expect(
        service.validateSAMLResponse({
          workspaceId: WORKSPACE_ID,
          identityProviderId: IDENTITY_PROVIDER_ID,
          samlResponseXml: Buffer.from(xml).toString('base64'),
        }),
      ).rejects.toThrow(SSOException);
    });

    it('rejects an assertion outside its NotBefore/NotOnOrAfter window (expired)', async () => {
      mockActiveProvider();

      const past = new Date(Date.now() - 10 * 60_000).toISOString();
      const morePast = new Date(Date.now() - 20 * 60_000).toISOString();

      const xml = buildSignedSamlResponseXml({
        privateKeyPem,
        notBefore: morePast,
        notOnOrAfter: past,
      });

      await expect(
        service.validateSAMLResponse({
          workspaceId: WORKSPACE_ID,
          identityProviderId: IDENTITY_PROVIDER_ID,
          samlResponseXml: Buffer.from(xml).toString('base64'),
        }),
      ).rejects.toThrow(SSOException);
    });

    it('rejects an assertion with the wrong audience', async () => {
      mockActiveProvider();

      const xml = buildSignedSamlResponseXml({
        privateKeyPem,
        ...validWindow(),
        audience: 'https://not-our-sp.example.com',
      });

      await expect(
        service.validateSAMLResponse({
          workspaceId: WORKSPACE_ID,
          identityProviderId: IDENTITY_PROVIDER_ID,
          samlResponseXml: Buffer.from(xml).toString('base64'),
        }),
      ).rejects.toThrow(SSOException);
    });

    it('rejects an assertion whose issuer does not match the configured identity provider', async () => {
      mockActiveProvider();

      const xml = buildSignedSamlResponseXml({
        privateKeyPem,
        ...validWindow(),
        issuer: 'https://a-completely-different-idp.example.com',
      });

      await expect(
        service.validateSAMLResponse({
          workspaceId: WORKSPACE_ID,
          identityProviderId: IDENTITY_PROVIDER_ID,
          samlResponseXml: Buffer.from(xml).toString('base64'),
        }),
      ).rejects.toThrow(SSOException);
    });
  });
});
