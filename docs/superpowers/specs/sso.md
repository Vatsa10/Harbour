# Spec — SSO (SAML 2.0 and OIDC)

Status: **STAGE 1 FORCED AND SMALL. STAGE 2 DEFERRED UNDER A TRIGGER.**
Scope: `core-modules/sso`, the SSO pieces of `core-modules/auth`, and the AGPL call sites that import them.
Written against: OASIS SAML 2.0 (core, bindings, profiles), OpenID Connect Core 1.0 + Discovery 1.0, RFC 6749/7636/8414, and this repo's AGPL auth module. No `@license Enterprise` file was opened; the contract below is reconstructed entirely from AGPL consumers.

---

## 1. Verdict, and a correction to the audit

The enterprise audit says **DEFER**, and reasons that SSO can be "left in place, dark and unreachable, at essentially zero maintenance cost."

**The reasoning does not survive the relicensing goal.** SeaRM's SSO is not free to leave in place, because 24 of its server files and 26 of its front files carry `@license Enterprise` and therefore cannot ship in an AGPL fork at all. Measured, 2026-08-17 at HEAD `a0320502fe`:

```
$ grep -rl "@license Enterprise" searm-server/src/engine/core-modules/{auth,sso} | wc -l
24
$ grep -rl "@license Enterprise" searm-front/src/modules/{settings/security,auth} | wc -l
26
$ grep -rl "@license Enterprise" searm-front/src/pages/settings/security | wc -l
1
```

"Dark" is a runtime property. Licensing is a distribution property. Dead code still ships.

So the disposition splits in two, and the split is what makes this tractable:

| Stage | Content | When | Size |
| --- | --- | --- | --- |
| **1 — forced** | The entity, the two enums, the `AvailableWorkspace['sso']` DTO shape, an empty module. No protocol code. | Now, with the rest of the enterprise removal. | ~6 server files, ~2 front. |
| **2 — deferred** | SAML + OIDC strategies, guards, callback controller, admin CRUD, JIT provisioning, front forms. | On the trigger below. | ~20 server, ~20 front. |

Stage 1 is unavoidable because AGPL code — code we keep — imports the enterprise types today. Stage 2 is genuinely deferrable because nothing calls into it.

**Build trigger for Stage 2.** Any one of:
- a prospect or customer states an IdP requirement in writing (Okta, Entra ID, Google Workspace as SAML IdP, Ping, JumpCloud, Keycloak, Authentik);
- a self-hoster files an issue asking to put SeaRM behind their existing Keycloak/Authentik — this is *more* likely than the hosted case and is the cheaper half (OIDC only);
- workspace seat count crosses roughly 50 at any single customer, where manual account administration stops being tolerable.

Build **OIDC first and alone** when the trigger is self-hosters. OIDC is a fraction of SAML's cost, and Keycloak/Authentik/Auth0/Entra all speak it. SAML is the enterprise-procurement checkbox and should wait for an enterprise deal that names it.

The rest of this document specifies Stage 2 so that when the trigger fires it is a build, not a design.

---

## 2. Stage 1 — the forced minimum

### 2.1 The contract AGPL code already requires

Four AGPL files import from the enterprise SSO entity. They pin the shape exactly, and none of it is expressive — it is a table definition and two closed enums:

| AGPL consumer | What it needs |
| --- | --- |
| `workspace/workspace.entity.ts:206-209` | `@OneToMany` relation `workspaceSSOIdentityProviders` |
| `workspace/utils/get-auth-providers-by-workspace.util.ts:30-42` | `.status === SSOIdentityProviderStatus.Active`; projects `{ id, name, type, status, issuer }` |
| `workspace/dtos/public-workspace-data.dto.ts:11-32` | `SSOIdentityProviderDTO` and `AuthProvidersDTO.sso: SSOIdentityProviderDTO[]` |
| `user-workspace/user-workspace.service.ts:587-616` | same five fields; compares `status === 'Inactive'` as a **string literal** |

Two AGPL specs already assert against it — `workspace/utils/__tests__/get-auth-providers-by-workspace.util.spec.ts` uses `IdentityProviderType.SAML` and both status values. **That spec is the acceptance test for Stage 1.** It is AGPL, it describes the contract precisely, and it must stay green through the swap without being edited. If it needs editing, the replacement is wrong.

Note the string-literal comparison at `user-workspace.service.ts:602`. Keep the enum's *values* as `'Active'` / `'Inactive'` or that line silently stops filtering inactive providers — a defect that shows an unusable login button rather than throwing. Cover it with a test.

### 2.2 What Stage 1 writes

```
core-modules/sso/
  workspace-sso-identity-provider.entity.ts   # entity + both enums
  dtos/sso-identity-provider.dto.ts           # GraphQL object type
  sso.module.ts                               # TypeOrmModule.forFeature only
  __tests__/workspace-sso-identity-provider.entity.spec.ts
```

Entity, workspace-scoped, `core` schema, following this repo's existing entity conventions (`@ObjectType`, `Relation<>` wrappers, `TimestampColumns`):

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `workspaceId` | uuid FK → `workspace`, `ON DELETE CASCADE` | The isolation boundary. Non-null. |
| `type` | enum `IdentityProviderType` = `OIDC` \| `SAML` | Default `OIDC`. |
| `name` | text | Admin-facing label; shown on the login button. |
| `status` | enum `SSOIdentityProviderStatus` = `Active` \| `Inactive` | Default `Active`. |
| `issuer` | text | OIDC issuer URL, or SAML IdP EntityID. |
| `config` | `jsonb`, nullable | Protocol config. **Empty and unread in Stage 1.** |
| `createdAt` / `updatedAt` / `deletedAt` | timestamptz | Repo convention. |

Constraint: `UNIQUE (workspaceId, issuer) WHERE deletedAt IS NULL`. One workspace cannot register the same IdP twice; two workspaces may both use Okta.

Only the five projected fields are GraphQL-exposed. `config` is never in the schema — see §7.

### 2.3 What Stage 1 deletes

All 24 enterprise server files and all 27 enterprise front files listed by the greps in §1 (26 under `modules/`, plus `pages/settings/security/SettingsSecuritySSOIdentifyProvider.tsx`), **minus** the four Stage-1 replacements, **plus** these three that are not obviously SSO:

- `auth/guards/enterprise-features-enabled.guard.ts` — dies with Cluster 4.1's shim, not here. Noted so it is not double-counted.
- `auth/dto/available-workspaces.dto.ts` — enterprise, but imported by AGPL `user.resolver.ts:22, :605-614`, `user-workspace.service.ts:18, :615` and `available-workspaces-and-access-tokens.dto.ts:3`. **This one must be rewritten in Stage 1**, not deleted; it is the workspace-picker payload and only its `sso` field is SSO-related.
- `pages/settings/domains/SettingsCustomDomainPage.tsx` — Cluster 4.4's deletion, unrelated.

Front Stage 1: keep the AGPL sign-in-up shell; delete the seven enterprise `SSO/` form components, the six GraphQL documents, the four hooks, the state/type/validation/util files, and `SettingsSecuritySSOIdentifyProvider.tsx`. The security settings page loses its SSO section and gains nothing — no "upgrade" placeholder, no disabled control. A feature that does not exist is not advertised.

### 2.4 Stage 1 gate

1. `grep -rl "@license Enterprise" searm-server/src/engine/core-modules/{auth,sso} | wc -l` → 1 (`enterprise-features-enabled.guard.ts`, pending 4.1)
2. `bash ../../scripts/lowmem.sh types` clean
3. `get-auth-providers-by-workspace.util.spec.ts` green, **unedited** — `git diff --stat` on that path shows nothing
4. Server boots; `/healthz` ok; zero `Nest can't resolve`
5. GraphQL schema diff: `Workspace.workspaceSSOIdentityProviders` and `AuthProviders.sso` unchanged in shape; the five `sso*` mutations/queries gone
6. Migration applies forward on a database with existing rows, and the `(workspaceId, issuer)` unique index is verified by attempting a duplicate insert

---

## 3. Stage 2 — libraries first

This section is the strongest argument in the document, so it comes before the design.

**Do not hand-roll any of the protocol.** Not the XML signature verification, not the JWT validation, not the nonce handling. The dependencies are already in `packages/searm-server/package.json` and already installed:

| Concern | Library | Version present | What it does |
| --- | --- | --- | --- |
| SAML 2.0 SP | `@node-saml/passport-saml` `^5.1.0` | installed | Passport strategy: AuthnRequest generation, redirect/POST bindings, RelayState. |
| SAML crypto | `@node-saml/node-saml` `5.1.0` | installed | The part that matters. XML canonicalisation, XML-DSig verification via `xml-crypto`, assertion decryption, `InResponseTo` tracking, clock-skew tolerance. |
| OIDC RP | `openid-client` `^5.7.0` | 5.7.0 installed | OpenID-Foundation-certified relying party: discovery, JWKS fetch and rotation, code exchange, PKCE, ID-token signature/claim validation, nonce. |
| Passport glue | `passport` `^0.7.0`, `@nestjs/passport` `11.0.5` | installed | Already how `google.auth.strategy.ts` and `microsoft.auth.strategy.ts` work here. |

### Why this is non-negotiable

SAML's entire CVE history is one bug repeated: **XML Signature Wrapping**. An attacker moves a signed assertion into a position the signature still covers, and injects an unsigned assertion where the parser reads. The exploit requires no key material. The mitigation is not "check the signature" — it is *resolve the signature's `Reference` URI to the exact element you parse, canonicalise identically, and reject documents with multiple assertions or unexpected `Reference` counts*. That logic is subtle enough that mature implementations have shipped it wrong repeatedly (`xml-crypto`, `python-saml`, `ruby-saml`, Shibboleth). Nobody writes it fresh in 2026.

OIDC is friendlier but has the same character: ID-token validation means checking `iss`, `aud`, `exp`, `iat`, `nonce`, `azp`, the signature against the right key from a rotating JWKS, and the `alg` against an allow-list that excludes `none`. Every one of those has a documented bypass when omitted.

**Rule: if a task in the Stage 2 plan reads "implement X of the protocol", it is mis-scoped.** The correct tasks are "configure the library", "validate the config we pass it", "map its output to a user", and "test the library's failure modes are surfaced correctly." The protocol libraries are dependencies with CVE feeds; pin them, watch them, and upgrade them.

### Two library notes worth carrying

- **`openid-client` v6 is a rewrite.** v6 dropped the built-in Passport strategy in favour of a standalone functional API. We are on 5.7.0 and Stage 2 should build against 5.x's `Strategy` export, which matches how `google.auth.strategy.ts` is wired here. Budget the v6 migration as separate, later work; do not attempt it during the Stage 2 build.
- `@node-saml/passport-saml` 5.x requires an explicit signing/encryption cert and refuses several unsafe defaults that 4.x tolerated. That is the desired behaviour; do not relax it to make a stubborn IdP work.

---

## 4. Stage 2 — identity-provider configuration model

The `config` jsonb column from §2.2 becomes a discriminated union on `type`. Validated with the repo's existing `class-validator` decorators at the input boundary, never trusted from the database.

### 4.1 OIDC

| Field | Required | Validation |
| --- | --- | --- |
| `issuer` | yes | Absolute `https://` URL. Must equal the `issuer` claim returned by discovery. |
| `clientId` | yes | non-empty |
| `clientSecret` | yes | non-empty; **encrypted at rest**, see §7 |
| `scopes` | no | defaults `['openid', 'email', 'profile']`; `openid` forced present |

Everything else — `authorization_endpoint`, `token_endpoint`, `jwks_uri`, `userinfo_endpoint`, supported algorithms — comes from **discovery only**: `GET {issuer}/.well-known/openid-configuration` (RFC 8414 / OIDC Discovery 1.0). Manual endpoint entry is not offered. It is four extra form fields, four extra ways to be misconfigured, and it enables an admin to point the token endpoint somewhere the issuer does not control.

Discovery runs once at setup, is validated, and the result is cached in Redis (TTL 1h). JWKS rotation is `openid-client`'s job; do not cache keys ourselves.

Redirect URI, fixed and registered at the IdP: `{SERVER_URL}/auth/oidc/callback`.

### 4.2 SAML 2.0

| Field | Required | Validation |
| --- | --- | --- |
| `entityId` (IdP EntityID) | yes | absolute URI; stored in the `issuer` column |
| `ssoUrl` | yes | `https://` URL — the IdP SSO endpoint (HTTP-Redirect binding) |
| `certificate` | yes | one or more PEM X.509 certs; parsed, expiry checked, **rejected if expired** |
| `wantAssertionsSigned` | — | forced `true` |
| `wantAuthnResponseSigned` | — | forced `true` |
| `signatureAlgorithm` | — | forced `sha256`; SHA-1 rejected |

The last three are not settings. They are constants presented as settings by other products, and the settings exist so that a broken IdP integration can be made to "work" by turning off security. We do not offer that. If an IdP cannot sign assertions with SHA-256, the integration fails with an actionable error.

Admin ergonomics: accept an **IdP metadata XML upload** and extract `entityId`, `ssoUrl` and certificates from it. Every IdP emits this file; typing three fields by hand is where misconfiguration comes from. Parse it with the SAML library's metadata reader, not a hand-written XML walk.

Our SP metadata is served at `GET /auth/saml/{identityProviderId}/metadata` — unauthenticated, since it contains only public data — so admins can upload it to the IdP rather than transcribe. EntityID: `{SERVER_URL}/auth/saml/{identityProviderId}`. ACS: `{SERVER_URL}/auth/saml/{identityProviderId}/callback`, HTTP-POST binding.

Per-IdP paths, not a single shared callback, so the callback route itself identifies the provider without trusting anything in the request body.

### 4.3 Admin surface

Five GraphQL operations on `SsoResolver`, all guarded by `WorkspaceAuthGuard` plus a workspace-admin permission check through the AGPL `PermissionsService` — **not** an enterprise/plan guard, which no longer exists:

`listSsoIdentityProviders`, `createOidcIdentityProvider`, `createSamlIdentityProvider`, `updateSsoIdentityProvider` (name, status, cert rotation), `deleteSsoIdentityProvider` (soft delete).

Every one emits an event-log entry (Cluster 4.2), because "who added an identity provider to my workspace" is precisely the question an audit trail exists to answer. Per the charter's principal contract, the entry records the authenticated user, not just the workspace.

---

## 5. Stage 2 — the authentication flow

Both protocols reduce to the same five steps, and only steps 2 and 3 differ.

```
1. Discover   browser → GET /auth/workspace-data (unauthenticated)
              ← AuthProviders { google, microsoft, password, sso: [{id,name,type,...}] }
              Login page renders one button per Active provider.

2. Initiate   browser → GET /auth/{saml|oidc}/{identityProviderId}/login?returnToPath=…
              Guard resolves the IdP, asserts status=Active, asserts it belongs
              to the workspace the request is for.
              Strategy builds AuthnRequest (SAML) or authorization request with
              PKCE + nonce + state (OIDC) and 302s to the IdP.

3. Assert     IdP authenticates the user, posts/redirects back:
              SAML → POST /auth/saml/{id}/callback   (HTTP-POST binding, SAMLResponse + RelayState)
              OIDC → GET  /auth/oidc/callback        (code + state)
              The LIBRARY validates. We validate nothing cryptographic ourselves.

4. Resolve    Extract the verified email. Resolve or JIT-provision the user (§6).

5. Issue      Mint a login token via the existing AGPL token services and redirect
              to the front-end exactly as signInUpWithSocialSSO already does
              (auth.service.ts:954-1011).
```

### 5.1 What carries state across the round trip

SeaRM's Google strategy stuffs a JSON blob into the OAuth `state` parameter (`google.auth.strategy.ts:52-66`) and parses it back on return. Match that pattern for OIDC — it is the AGPL convention here and the front end already builds these params.

SAML has no `state`; it has `RelayState`, an opaque IdP-echoed string with a 80-byte practical limit. **Do not put a JSON blob in it.** Store the pre-auth context (`identityProviderId`, `returnToPath`, `workspaceId`, the PKCE/request id) in Redis under a random 128-bit key with a 10-minute TTL, and put only that key in `RelayState`. This also gives replay protection for free: the key is deleted on first use, so a captured `RelayState` cannot be reused.

`returnToPath` is validated on the way out with the existing AGPL `validate-redirect-uri.util.ts` — it must be same-origin and start with `/`. This is the open-redirect surface, and it is the single most commonly missed check in an SSO integration.

### 5.2 Security requirements, as testable assertions

Every one of these is an integration test with a crafted-input fixture, not a code comment:

| # | Requirement | Test |
| --- | --- | --- |
| 1 | Unsigned SAML assertion rejected | strip `<ds:Signature>`, expect 401 |
| 2 | Assertion signed by a different key rejected | re-sign with a foreign cert, expect 401 |
| 3 | XML Signature Wrapping rejected | inject a second unsigned assertion, expect 401 |
| 4 | Expired assertion rejected | `NotOnOrAfter` in the past, expect 401 |
| 5 | Wrong audience rejected | `Audience` ≠ our EntityID, expect 401 |
| 6 | Replay rejected | POST the same valid response twice, expect 401 on the second |
| 7 | `InResponseTo` mismatch rejected | unsolicited response to a live session, expect 401 |
| 8 | ID token with `alg: none` rejected | expect 401 |
| 9 | ID token with wrong `aud` / `iss` / expired / bad `nonce` rejected | four cases, expect 401 |
| 10 | Authorization code replay rejected | expect 401 |
| 11 | Cross-workspace binding enforced | IdP of workspace A cannot authenticate into workspace B, expect 403 |
| 12 | Open redirect blocked | `returnToPath=https://evil.example`, expect the value dropped, not followed |
| 13 | Inactive IdP cannot initiate | `status = Inactive`, expect 404 at `/login` |

Items 1–10 mostly test *that the library is wired correctly*, which is exactly the right thing to test — the common failure is not a broken library but a config flag that disabled it.

Item 11 deserves emphasis. In a multi-tenant CRM the highest-severity SSO bug is not signature bypass; it is a valid assertion from tenant A's IdP minting a session in tenant B. The check is: the `identityProviderId` in the callback path resolves to a row whose `workspaceId` equals the workspace being signed into, and the resulting user is added to *that* workspace only.

**IdP-initiated SSO is not supported.** It has no `InResponseTo` to bind, which removes requirement 7 entirely and makes CSRF-into-login viable. Okta and Entra both support SP-initiated. If a customer's IdP insists, that is a conversation, not a config flag.

---

## 6. Stage 2 — JIT provisioning

JIT is where SSO stops being a protocol problem and becomes a data problem: an IdP assertion is a request to create a user in a CRM tenant. The rule is narrow.

### 6.1 The rule

> A successful SSO assertion may add a user to **the one workspace that owns the identity provider**, with **the default member role**, and nothing else.

It may not create a workspace. It may not grant admin. It may not choose a role from an assertion attribute. It may not add the user to a second workspace.

### 6.2 The algorithm

```
email := verified email claim  (OIDC: `email` with `email_verified` true;
                                SAML: NameID when format=emailAddress,
                                      else the configured email attribute)
if no verified email        → 401  EMAIL_NOT_VERIFIED
email := lowercase(email)

workspace := identityProvider.workspace          # never from the assertion

user := findUserByEmail(email)
if user exists and is already a member of workspace → sign in. Done.
if user exists and is not a member                  → JIT-add (below)
if user does not exist                              → JIT-create + JIT-add
```

JIT-add reuses the AGPL path unchanged: `SignInUpService.signInUpOnExistingWorkspace()` (`sign-in-up.service.ts:310-360`), which already calls `throwIfWorkspaceIsNotReadyForSignInUp` (`:272`), `saveNewUser`, `activateOnboardingForUser` and `addUserToWorkspaceIfUserNotInWorkspace`. **Write no new provisioning code.** SSO's job ends at producing `{ email, firstName, lastName, picture }` and a workspace; everything downstream is the same code path Google auth uses.

Three consequences of reusing it, all desirable: workspace activation status is respected; onboarding steps (create-profile, connect-account) are triggered identically; the default role assignment stays in one place.

### 6.3 The gate on JIT

An active IdP on a workspace means *anyone that IdP will authenticate can join that workspace*. That is usually right — the IdP is the customer's own directory — and occasionally catastrophic, when the IdP is a shared consumer tenant.

So JIT is a per-IdP boolean, `jitProvisioningEnabled`, default **`true`**, with an escape hatch:
- `true` — new users are created and added. The normal enterprise expectation.
- `false` — SSO authenticates only users who are already members. Unknown email → 403 with a message naming the workspace admin. Useful when the directory is broader than the intended user set.

SeaRM's existing `approvedAccessDomains` relation on `WorkspaceEntity` composes on top: when it is populated, the SSO email's domain must also match. Reuse it rather than adding a second domain allow-list.

### 6.4 Attribute mapping

Fixed and minimal:

| Field | OIDC claim | SAML attribute |
| --- | --- | --- |
| email | `email` (requires `email_verified: true`) | `NameID` (emailAddress format) or configured attribute name |
| firstName | `given_name` | `urn:oid:2.5.4.42` / `firstName` / `givenName` |
| lastName | `family_name` | `urn:oid:2.5.4.4` / `lastName` / `surname` |
| picture | `picture` | not mapped |

Group and role attributes are **not read**. See §8 — role mapping is a real feature with a real trigger, and shipping a half version of it (map a string to a role name, hope the customer's IdP agrees) is worse than not having it.

On subsequent logins, name and picture are **not** overwritten from the assertion. A user who edited their CRM profile should not have it reverted by their directory every morning. Only the initial JIT create populates them.

---

## 7. Composition with existing auth

SeaRM's AGPL auth already models multiple providers, and SSO slots into the existing shape without new concepts:

- `AuthProviderEnum` (`workspace/types/workspace.type.ts`) already has `SSO = 'sso'`, alongside `Google`, `Microsoft`, `Password`, `Impersonation`. Nothing to add.
- `getAuthProvidersByWorkspace()` already returns `sso: [...]` next to the three booleans. Nothing to add.
- `AuthSsoService.findWorkspaceFromWorkspaceIdOrAuthProvider()` (`auth/services/auth-sso.service.ts`) maps a provider to its workspace column (`isGoogleAuthEnabled`, `isMicrosoftAuthEnabled`, `isPasswordAuthEnabled`) and throws for anything else. This is the one AGPL file Stage 2 must extend, because SSO's enablement is per-IdP-row rather than a boolean column. Extend by short-circuiting on `AuthProviderEnum.SSO` to a query over active identity providers — do not add an `isSsoAuthEnabled` column, which would be a fourth source of truth alongside the rows.
- Token issuance, workspace-picker redirect and the `ssoExchangeToken` fragment hand-off (`auth.service.ts:992-1010`) are shared verbatim. That code path exists because Google/Microsoft sign-in needed it; SSO needs exactly the same thing.

### The composition rules

1. **Providers compose; they do not exclude.** A workspace may have password *and* Google *and* two IdPs simultaneously. There is no "SSO enforced, all other methods disabled" mode in Stage 2 — see §8, it is a real request with a real trigger and a real lockout risk that needs designing properly.
2. **Email is the join key, and it is authoritative only when verified.** A user who signed up with a password and later arrives via SAML with the same verified address is the same user. This is why `email_verified` and the SAML NameID format check are load-bearing rather than pedantic.
3. **Provider identity is recorded per login**, not per user. A user has no single "auth provider"; they have a login history. This matters for the charter's principal contract: the audit entry for an SSO login names the IdP.
4. **`config` never crosses the GraphQL boundary.** `clientSecret` is written once and never read back — the update mutation accepts a new value or leaves it alone; there is no query that returns it. Store it encrypted at rest using the same mechanism the repo already uses for connected-account tokens, and confirm which that is before writing the migration.

---

## 8. Deliberately cut, with triggers

Per the charter: nothing is dropped silently.

| Cut | Trigger to build |
| --- | --- |
| **SCIM 2.0 provisioning / deprovisioning** | A customer above ~200 seats, or any customer whose security review names offboarding latency. This is the single largest omission and the honest one — JIT creates users but nothing removes them when the IdP does. Until SCIM exists, document that deactivation is manual, and make sure it is *possible*. |
| **Single Logout (SLO)** | A customer asks. SAML SLO is widely implemented badly and rarely used; our session TTL is the practical control. |
| **IdP-initiated SSO** | A customer's IdP genuinely cannot do SP-initiated. Requires designing a replacement for `InResponseTo` replay protection first. |
| **Group → role mapping** | A customer with more than two distinct role populations who has already deployed SSO and asks. Needs a mapping UI and a conflict policy; not a one-line attribute read. |
| **Enforce-SSO-only (disable password for a workspace)** | A security review demands it. Must ship *with* a break-glass path, or the first misconfigured IdP locks a customer out of their own CRM permanently. |
| **Multiple IdPs per workspace with domain routing** | A customer post-acquisition running two directories. The schema already allows multiple rows; only the routing logic is missing. |
| **Automatic IdP metadata refresh / cert rotation alerts** | First expired-certificate outage. Cheap mitigation available now: reject expired certs at setup (§4.2) and surface expiry in the admin list. |
| **Step-up / re-authentication for sensitive actions** (`acr_values`, `ForceAuthn`) | When approving a proposal is judged to warrant re-auth. Interesting given the charter's approval model — revisit once the approval inbox has real usage. |
| **Passwordless / magic link** | `getAuthProvidersByWorkspace` already returns `magicLink: false` hard-coded. Out of scope; note it exists as a stub. |
| **LDAP / Active Directory direct bind** | Never, absent a compelling deal. ADFS and Entra both speak SAML/OIDC; direct LDAP means holding directory credentials. |

---

## 9. Stage 2 gate

The feature is done when all of these have recorded output:

1. All 13 assertions in §5.2 pass as integration tests, and each **fails when mutated** — flip the corresponding library option off and confirm the test goes red. A security test that passes against a disabled control is worthless.
2. End-to-end against a real IdP, not a mock: a Keycloak container for OIDC and a SimpleSAMLphp or Keycloak SAML container for SAML, both run in CI. Fixtures alone do not catch discovery, JWKS, canonicalisation or binding bugs — which is the entire class of bug this feature has.
3. JIT walked by hand: unknown email → user created, added to exactly one workspace, default role, onboarding triggered. Verified in the database, not in a log line.
4. Cross-tenant test (§5.2 #11) passes.
5. `jitProvisioningEnabled = false` → unknown email gets 403 and **no** user row is created. Check the table.
6. A workspace with password + Google + SAML + OIDC all active shows four login options and all four work, in one session, against one user.
7. Audit: an SSO login and an IdP config change both appear in the event log with the correct principal.
8. `bash ../../scripts/lowmem.sh types` and `… itest` clean.
9. Self-hosted smoke: SSO configured through the admin UI on a fresh instance with no external services beyond the IdP.

---

## 10. Cost, honestly

Stage 1 is roughly a day: an entity, two enums, a DTO, a migration, and deletions that the AGPL specs already validate.

Stage 2 is not small. The protocol work is a library call; the surrounding work — config validation, metadata parsing and serving, per-IdP routing, Redis-backed RelayState, JIT wiring, the admin UI, and thirteen adversarial tests against two containerised IdPs — is realistically two to three weeks done properly, and "properly" is the only acceptable standard for an authentication path in a multi-tenant CRM.

That cost is the argument for the trigger. It buys nothing until a specific customer needs it, and it is not the kind of work that benefits from being done early and left to rot: IdP behaviour, library APIs and CVE surface all move. Build it against a customer's actual Okta tenant, not against a hypothetical one.
