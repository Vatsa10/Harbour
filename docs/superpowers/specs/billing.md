# Spec — Billing

Status: **DELETE NOW. BUILD LATER, UNDER A TRIGGER.**
Scope: `packages/twenty-server/src/engine/core-modules/billing`, `…/billing-webhook`, `…/ai-billing`, and every AGPL call site that imports them.
Written against: the SeaRM Product Charter, the enterprise audit (`.superpowers/sdd/enterprise-rewrite/enterprise-audit.md`), and Stripe's public API documentation. No `@license Enterprise` file was opened.

---

## 1. Verdict

The honest answer is the one the brief anticipated: **this should be deleted now and built when there is a customer to bill.**

This is not a cost-cutting judgement. It is a charter judgement. The charter says:

> Cloud and self-hosted ship from the same codebase. **Hosted billing and provisioning stay optional and never become a dependency of self-hosting.**

Billing is, today, a compile-time dependency of self-hosting. That is a live charter violation, and it is a violation that gets *worse* the longer the code stays, because every new module that wants a credit check adds another constructor parameter pointing at Stripe.

Three facts settle it:

1. **There is no hosted SeaRM.** No Stripe account, no price catalog, no customer, no invoice. Every line of the 152 enterprise-licensed files in this cluster models a price book that does not exist.
2. **The code is already dead at runtime.** `IS_BILLING_ENABLED` defaults to unset — `packages/twenty-server/.env.example:22` reads `# IS_BILLING_ENABLED=false`. Every consumer short-circuits: `workspace.resolver.ts:184, :280, :293` return early, `ai-billing.service.ts:102-104` returns `{ hasNoMoreAvailableCredits: false }`, and the same guard repeats in `workflow-executor.workspace-service.ts`, `logic-function-executor.service.ts` and `email-billing.service.ts`. Deleting it removes no behaviour any deployment currently has.
3. **It is not ours to keep.** 152 of the 198 files under `billing/`, `billing-webhook/` and `usage/` carry `@license Enterprise`. They cannot ship in an AGPL fork at all. "Leave it for later" is not on the menu; the only choices are *delete* or *rewrite from scratch*, and rewriting a Stripe integration for zero customers is indefensible.

Measured, 2026-08-17, at branch `ai-native-crm` HEAD `a0320502fe`:

```
$ find twenty-server/src/engine/core-modules/{billing,billing-webhook,usage} -type f | wc -l
198
$ grep -rl "@license Enterprise" twenty-server/src/engine/core-modules/{billing,billing-webhook,usage} | wc -l
152
```

**Build trigger.** Write the hosted-billing module when *all three* of these are true, not before:
- a signed customer or a live trial that is contractually going to be invoiced;
- a decided price model (per-seat, per-workspace, metered, or a hybrid) with actual numbers;
- someone accountable for tax, dunning and refunds who is not an engineer.

Until then, hosted SeaRM invoices out of band. A spreadsheet and a Stripe payment link bill ten customers perfectly well and cost nothing to maintain.

---

## 2. The one hard architectural rule

When billing does get built, exactly one rule governs it. Everything else in this document is detail.

> **The dependency graph points one way: `billing → core`. Never `core → billing`.**
> No file under `src/engine/**` or `src/modules/**` may import from `src/engine/core-modules/billing/**`. Billing observes the core through domain events and public read APIs. The core does not know billing exists.

### Why this rule and not an interface

The tempting alternative is a `BillingPort` interface with a null implementation, injected everywhere. Reject it. It preserves the exact defect we are removing — thirty modules that structurally expect a billing answer — and merely renames the coupling. A null object still means `WorkflowExecutorService` has a billing-shaped hole in its constructor, and that hole will fill up again.

A directed dependency rule has no such hole. A self-hosted instance does not "disable" billing; it is *structurally incapable* of consulting it, because nothing on the read or write path has a reference to reach through.

### How the rule is enforced

Not by convention. By a test that fails the build.

```
packages/twenty-server/src/engine/__architecture-tests__/billing-isolation.spec.ts
```

The test walks every `.ts` file under `src/engine` and `src/modules`, parses its import specifiers, and asserts that no path outside `src/engine/core-modules/billing/` resolves into it. Two allowances, both explicit and both enumerated in the test file itself:

| Allowance | Why |
| --- | --- |
| `core-engine.module.ts` may conditionally register `BillingModule` | Nest needs one composition-root edge; it imports the module token only, never a service. |
| `billing/**` may import freely from core | That is the permitted direction. |

Mutation check for the test itself: add `import { BillingService } from 'src/engine/core-modules/billing/services/billing.service'` to any core file and the spec must go red. If it does not, the test is decorative.

### The corollary rule for behaviour

> **A self-hosted instance must not degrade without billing — it must be identical.**

Concretely: with the billing module absent, there is no credit ceiling, no trial banner, no plan gate, no seat cap, no "upgrade to continue". Not a disabled version of those. Their absence. If a feature is worth shipping self-hosted, it ships unconditionally; if it is not, it does not exist. There is no third state.

This is the clause that kills the `EnterpriseFeaturesEnabledGuard` pattern as well — noted here because the two removals share a motive, though the guard is Cluster 4.1's work, not this spec's.

---

## 3. What is *not* billing

The deletion has a boundary, and getting it wrong is the main way this task goes badly.

### 3.1 The usage ledger stays

`core-modules/usage` (15 files, all `@license Enterprise`, zero Stripe imports) is a **spend ledger**, not a billing system. It records what a workspace consumed. Whether anyone is charged for that consumption is a separate question, and for self-hosted the answer is permanently "no one" — yet the ledger is still wanted, because the charter's trust story requires cost attribution:

> `AgentRun` — … token and cost usage …
> Metrics, structured logs, health signals, error reporting, and **agent-cost attribution**.

It is also already load-bearing in *our* code: `ai-research/jobs/agent-task-run.job.ts:11` imports `UsageOperationType`, and `ai-trust-dashboard` reimplements a slice of the same idea locally against `AgentRunEntity.creditsUsedMicro`.

**Disposition: rewrite as AGPL, in its own module, with no billing import.** That is a separate spec. This one only fixes its address: after the billing deletion, `usage` must not sit under or depend on `billing`, and the architecture test in §2 applies to it in reverse — `usage` may not import `billing`.

### 3.2 AI budgets stay, and are not credits

`ai-billing` is a credit-ceiling check: *has this workspace bought enough tokens?* Delete it.

The charter's budget requirement is a different thing: *has this task exceeded the limit its author set?*

> **Execution contract** — all workflows and agents are versioned, idempotent, cancellable, leased, retryable, and **budgeted**.
> `AgentTask` — … lease, retry count, **budget**, idempotency key, cancellation.

A per-task budget denominated in micro-credits, enforced by the agent executor against `AgentTask.budget` and `AgentRun` cost accounting, is a self-hosting feature. Self-hosters pay OpenAI directly and very much want a ceiling. It belongs to the trust layer and must survive the deletion intact. The four `isBillingEnabled()` guards in `ai-billing.service.ts`, `workflow-executor.workspace-service.ts`, `logic-function-executor.service.ts` and `email-billing.service.ts` are being removed *because they never fire*, not because budgets do not matter.

### 3.3 Not touched by this spec

Custom domains / Cloudflare DNS (Cluster 4.4) is a separate deletion with the same motive. Do not bundle them; they have independent blast radii and bundling them makes the revert unit too big.

---

## 4. Deletion plan

### 4.0 Preconditions

- Cluster 4.1 (the enterprise-gate shim) has landed. `billing.module.ts:41` and `billing-subscription.service.ts:39` reference `EnterprisePlanService`; going the other order means touching those files twice.
- The `usage` rewrite (§3.1) has landed **or** is sequenced immediately after, in the same branch. `usage` currently lives inside the deletion zone's import graph; deleting billing first with `usage` still enterprise-licensed leaves the tree uncompilable.
- A green baseline is recorded: `bash ../../scripts/lowmem.sh types` and `bash ../../scripts/lowmem.sh test` before any file is removed. Without it there is no way to tell a pre-existing failure from one you caused.

### 4.1 What gets deleted outright

| Path | Files | Note |
| --- | --- | --- |
| `core-modules/billing/**` | 150 (114 enterprise, 36 AGPL) | The 36 AGPL files are subscription-update math, price utils, the reminder cron and their specs. They model Stripe's object graph and have no consumer once Stripe is gone. Delete them too. |
| `core-modules/billing-webhook/**` | 27 (23 enterprise, 4 AGPL) | Inbound Stripe webhook receiver, mounted unauthenticated. |
| `metadata-modules/ai/ai-billing/**` | all | Credit-ceiling check. See §3.2. |
| `database/commands/upgrade-version-command/2-4/…migrate-to-billing-v2.command.ts` | 1 | Migrates Twenty Cloud subscriptions between Twenty's own price versions. Meaningless here. |
| `admin-panel/services/admin-panel-billing.service.ts` + its DTO + resolver field | 3 | Cloud-operator tooling. |
| Front: `pages/settings/billing/**`, `modules/billing/**`, `modules/information-banner/components/billing/**`, the onboarding plan-required path, `billingState`, `billingCheckoutSessionState` | — | See §4.4. |

### 4.2 The AGPL refactor — 57 server files

These are ours, they stay, and each needs a constructor parameter, module import, resolver field, cache key or enum reference removed. Measured:

```
$ grep -rl --include="*.ts" -e "core-modules/billing" -e "core-modules/usage" src > /tmp/b.txt; wc -l < /tmp/b.txt
217                                  # every file that imports billing or usage
$ grep -rL --include="*.ts" "@license Enterprise" $(cat /tmp/b.txt) \
    | grep -v -e "core-modules/billing/" -e "core-modules/billing-webhook/" \
              -e "core-modules/usage/"   -e "ai/ai-billing/" | wc -l
57                                   # AGPL, and outside the deletion zone
```

Grouped by what the edit actually is:

**a. Composition root (4 files) — do first, everything else depends on it.**
`core-engine.module.ts` (drop `BillingModule`, `BillingWebhookModule`, `AppBillingModule`, `AiBillingModule` from `imports`; drop the global `BillingGraphqlApiExceptionFilter` `APP_FILTER`), `message-queue/jobs.module.ts`, `database/commands/database-command.module.ts`, `database/commands/cron-register-all.command.ts`.

**b. Public GraphQL schema (4 files) — the only externally visible break.**
`workspace.resolver.ts` loses four resolve-fields: `billingSubscriptions` (`:180`), `currentBillingSubscription` (`:276`), `billingCustomer` (`:289`), `billingEntitlements` (`:320`). `workspace.module.ts`, `workspace.service.ts`, `client-config.entity.ts` + `client-config.service.ts` lose their billing config surface.

Note a correction to the audit: **`workspace.entity.ts` has no billing relation.** Verified —

```
$ grep -in "billing" twenty-server/src/engine/core-modules/workspace/workspace.entity.ts
(no output)
```

The only enterprise relation on `WorkspaceEntity` is `workspaceSSOIdentityProviders` (`:206-209`). This removes a whole class of risk the audit budgeted for: **no core-table migration is required.** The billing tables (`billingCustomer`, `billingSubscription`, `billingSubscriptionItem`, `billingProduct`, `billingPrice`, `billingMeter`) are standalone and are dropped by one forward migration with no FK untangling.

**c. Auth and onboarding (5 files).**
`auth.module.ts`, `sign-in-up.service.ts` (`:27, :28, :96, :97` — the `BillingCreditService` / `BillingService` injections, and the `ensureBillingCustomer` call at `:724-725`), `onboarding.module.ts`, `onboarding.service.ts` (`isSubscriptionIncompleteOnboardingStatus`, two `creditWorkspaceBalance` calls) plus their two specs.

The onboarding edit deserves attention: the `PLAN_REQUIRED` onboarding step disappears entirely. A new workspace goes straight from creation to `CREATE_PROFILE`. Verify by walking the flow, not by reading the enum.

**d. AI and workflow (15 files).**
`ai-agent-execution` (module + `agent-async-executor.service.ts` + `agent-run.service.ts` + spec), `ai-chat` (module, resolver, four services, one job), `ai-generate-text` (module + controller), `ai-graphql-api-exception-handler.util.ts`, `repair-tool-call.util.ts`, `workflow-executor` (module + service + spec + `ai-agent.workflow-action.ts`), `workflow-runner` (module + service), `logic-function-executor` (module + service).

Each drops an `isBillingEnabled()` guard whose false branch is the only branch that runs today. Where the guard wrapped a *budget* concept rather than a *credit* concept, re-point it at `AgentTask.budget` — do not silently delete the ceiling. §3.2.

**e. Ours (2 files) — the one hard import.**
`ai-research/jobs/agent-task-run.job.ts:11` imports `UsageOperationType` from the enterprise enum and uses it at `:168` as `operationType: UsageOperationType.AI_WORKFLOW_TOKEN`. Re-point at the rewritten AGPL `usage` module. `ai-agent-execution` reaches `BillingModule` transitively via `AiResearchModule`; that edge dies with (a).

**f. Types, cleanup, mail (11 files).**
`workspace-cache-key.type.ts` (drop `currentBillingSubscription: 'billing:subscription'`), `all-non-workspace-related-entity.type.ts` (drop 4 entities from the union), `cleaner.workspace-service.ts` + module, `list-and-delete-orphaned-workspace-entities.command.ts`, `emailing.module.ts` + `email-billing.service.ts`, `emailing-domain.module.ts`, `calendar-event-import-manager.module.ts`, `custom-domain-manager` (module + service), `event-logs.service.spec.ts`, `sso.service.spec.ts`.

### 4.3 Database migration

One forward migration, `dropBillingTables`:

```sql
DROP TABLE IF EXISTS core."billingSubscriptionItem",
                     core."billingSubscription",
                     core."billingCustomer",
                     core."billingPrice",
                     core."billingProduct",
                     core."billingMeter" CASCADE;
```

Confirm the exact table set from the generated migration history before writing it; do not trust this list. It is forward-only — there is no down path, and that is correct: the data describes a Stripe account SeaRM does not own.

### 4.4 Frontend

185 files under `twenty-front/src` mention billing once locale catalogues and generated GraphQL are excluded:

```
$ grep -rli --include="*.ts" --include="*.tsx" "billing" twenty-front/src | wc -l
217
$ … | grep -v -e "/locales/" -e "generated-metadata" -e "generated-admin" | wc -l
185
```

Three tiers:
- **Delete** — the billing settings pages, the five `InformationBanner*` billing components, the plan-required onboarding step and its four hooks/tests, `ChooseYourPlanErrorState`, the Stripe preload effect.
- **Regenerate** — `generated-metadata/graphql.ts` and `generated-admin/graphql.ts` follow the server schema. Never hand-edit.
- **Prune** — locale `.po` and `locales/generated/*.ts` entries drop out on the next extraction run. Do not hand-edit 32 catalogues.

The remainder are one-line references (`useAuth.ts`, `SettingsRoutes.tsx`, `currentWorkspaceState.ts`, the query-param plumbing that carried `billingCheckoutSessionState` through the Google/Microsoft OAuth `state` blob — see `google.auth.strategy.ts:58`, which must lose that field).

### 4.5 Verification — the gate

The deletion is done when all of these produce recorded output, in this order:

1. `grep -rn "core-modules/billing" packages/twenty-server/src | wc -l` → `0`
2. `grep -rl "@license Enterprise" packages/twenty-server/src/engine/core-modules | wc -l` → drops by 152
3. `cd packages/twenty-server && bash ../../scripts/lowmem.sh types` → clean
4. `bash ../../scripts/lowmem.sh test` → no new failures against the §4.0 baseline
5. Server boots: `/healthz` returns `{"status":"ok"}`, route count recorded, **zero** `Nest can't resolve` lines
6. GraphQL schema diff reviewed — exactly four fields gone from `Workspace`, nothing else
7. `billing-isolation.spec.ts` (§2) passes, **and fails when mutated** by adding a billing import to a core file
8. Sign-up → onboarding → first record, walked by hand on a fresh database. This is the one that catches the `PLAN_REQUIRED` step regression, and no unit test substitutes for it.

Paste the output of each. A claim without output is not a pass.

### 4.6 Risk register

| Risk | Mitigation |
| --- | --- |
| Concurrent fix waves on `ai-native-crm` touch the same 57 files | Re-read before every edit; commit in small units, per §4.2 group, within minutes. Do not hold a 57-file working tree. |
| Onboarding regresses silently — the `PLAN_REQUIRED` step is skipped incorrectly rather than removed | Gate item 8. Manual walk on a fresh DB. |
| The `usage` rewrite slips and `ai-research` breaks | Do not start §4.2(e) until the AGPL `UsageOperationType` exists. It is the sequencing pin. |
| Deleting the 36 AGPL billing files removes a util something else wanted | `grep` each for external importers before removal; the ones with importers move to a neutral home rather than dying. |

---

## 5. When the trigger fires: minimum hosted billing

Deferred. Written down now only so the future build is a build and not a design, and so the §2 rule is not renegotiated under deadline pressure.

**Shape.** One Nest module, `core-modules/hosted-billing`, mounted only when `HOSTED_BILLING_ENABLED=true`. Imports from core freely. Exports nothing that core imports. Roughly six files, not one hundred and sixty.

**Minimum model.** Two tables, both keyed by `workspaceId`, both owned by the module:
- `hostedBillingCustomer` — `workspaceId`, `stripeCustomerId`, timestamps.
- `hostedBillingSubscription` — `workspaceId`, `stripeSubscriptionId`, `status`, `currentPeriodEnd`, timestamps.

No product catalog, no price mirror, no subscription-item table, no meters, no credit grants, no schedules. **Stripe is the system of record for the price book.** Mirroring it locally is what produced 160 files, and every mirror is a cache-invalidation bug waiting for a webhook to be dropped. Read prices from Stripe's API at the two moments they are needed — rendering a plan page and opening a checkout — and cache them in Redis with a short TTL.

**Flows, against Stripe's documented public API.** Four, and only four:
1. *Start a subscription* — create a Checkout Session (`POST /v1/checkout/sessions`, mode `subscription`) with `client_reference_id = workspaceId`; redirect the admin.
2. *Manage a subscription* — create a Billing Portal session (`POST /v1/billing_portal/sessions`) and redirect. Upgrades, downgrades, cancellation, card updates and invoice history are all Stripe's UI. We build none of it. This single decision is most of the deleted 160 files.
3. *Stay in sync* — one webhook endpoint verifying `Stripe-Signature` per Stripe's documented scheme, handling exactly `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Handlers are idempotent on Stripe's `event.id`, persisted in a dedupe table, because Stripe documents at-least-once delivery.
4. *Report usage*, if and only if the price model is metered — a scheduled job that reads the AGPL `usage` ledger and pushes aggregates to Stripe's meter-event API. **One-way: ledger → Stripe.** Stripe never writes into the ledger, and the ledger has no idea Stripe exists.

**Enforcement.** A lapsed subscription on hosted SeaRM is handled at the edge — a middleware in the hosted-billing module that returns a 402 with a portal link — not by threading an entitlement check into thirty services. Entitlement keys as a concept do not come back.

**What is deliberately cut, per the charter's no-silent-drops rule:**

| Cut | Trigger to build |
| --- | --- |
| Local product/price mirror | When plan-page latency against Stripe's API is measured and shown to matter. |
| Free trials, coupons, promo codes | When sales actually offers one. Stripe supports all three natively via Checkout — likely no code at all. |
| Credit-grant / prepaid balance | When a customer asks to prepay. |
| Seat-count proration | When the price model is per-seat *and* seats change mid-cycle often enough to notice. |
| Dunning emails | Stripe Smart Retries plus Stripe's own emails first. Build ours when churn data says they are insufficient. |
| Tax | Stripe Tax is a configuration flag, not a feature. Turn it on; write nothing. |
| Multi-currency, invoicing-by-PO, annual contracts | First enterprise deal that demands one. |
| Self-serve plan comparison UI | When more than one plan exists. |

---

## 6. What this spec does not decide

- **The price model.** Deliberately. It is a business decision, it is a precondition of the build trigger, and specifying it now would only invite the code to be written around a guess.
- **Whether hosted SeaRM exists at all.** Self-hosted is the charter's centre of gravity and the go-to-market wedge names "privacy-conscious self-hosters" as an initial buyer. Hosted may turn out to be a distribution convenience rather than a product. Deleting billing keeps that option genuinely open; keeping a Stripe integration quietly forecloses it by making the hosted path the default-shaped one.
