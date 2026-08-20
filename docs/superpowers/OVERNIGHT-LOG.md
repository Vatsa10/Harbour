# Overnight run log

Owner asleep. Controller (Opus) running end to end with standing authorization: *"you handle this whole end to end."*

Everything here is local and reversible. No pushes. All work on branch `ai-write-approval` and successors. Nothing outward-facing.

## Standing decisions

Decisions the reconcile stage flags as "Owner decisions required" are adjudicated by the controller rather than blocking until morning. Each one is logged below with its rationale and how to reverse it. Anything genuinely irreversible or outward-facing is NOT decided — it waits.

## Plan for the run

1. Launch 1 (`wf_ada1d4c2-ba1`) — Task 8 integration suite, then the Opus whole-branch review. Findings get ONE fix wave and one scoped re-review; residuals get parked with rulings.
2. Phase 2-5 planning (`wf_b36542d0-e5e`) — four plans, Opus reconcile, Opus adversarial review.
3. Adjudicate the reconciler's owner-decision list. Log each call here.
4. Fix Critical findings from the adversarial plan review before any implementation starts. A plan that ships with known Critical defects wastes more time than it saves.
5. Implement the phases in the reconciler's recommended dependency order, same topology: Haiku on transcription tasks, Sonnet on judgement tasks, Opus on merges and reviews, worktree isolation wherever agents run in parallel.
6. Keep `.superpowers/sdd/*/progress.md` current with commit SHAs, so a context compaction does not lose the thread.

## Watchdog

Monitor `br5wlfbq6` polls every 60s. It fires on: a workflow journal going idle >15 min (the silent-death signature that cost us a run tonight), each phase plan appearing, and the program and review docs landing. Notifications alone are not trusted — a dropped connection produces no notification at all.

## Guardrails held throughout

- No `git push`. No remote is configured for pushing; `upstream` points at twentyhq/twenty and must never receive our commits.
- The five non-negotiable contracts in `PRODUCT-CHARTER.md` are not negotiable by any agent or by the controller.
- No AI write path may route around `ProposalGateService`.
- Nothing gets deleted — the three reference repos stay until their ports are built.

---

## Decision log

### 2026-08-06 — Launch 1 final review: CHANGES_REQUESTED (3 Critical, 9 Important, 10 Minor)

The review is at `twenty/.superpowers/sdd/2026-08-05-ai-write-approval/final-review.md`. It is worth reading in full — it is specific, cites file:line, and prescribes fixes.

**All three Criticals trace to defects in the plan I authored**, and two were concealed by passing tests:

- **C1 — the server cannot boot.** `TypeOrmModule.forFeature([...], 'core')` names a TypeORM connection that does not exist; `'core'` is a Postgres *schema*, not a connection. The Task 3 agent correctly detected this and dropped the argument; the Task 5 agent kept it; Merge 2 unioned both. The two spec files each mock the opposite DI token, so every suite stayed green over a two-way-broken DI graph. My plan asserted the `'core'` argument without verifying it.
- **C2 — `AUTO` overrides are unreachable.** My `resolveMode` unions every key, defaults each unmatched one, then takes the most restrictive — so the always-present bare object key drags the result back to the `PROPOSE` default. Per-field `AUTO` can never win. The spec said "most specific match wins"; I implemented something more complicated that gives the wrong answer. Fails safe (over-gating), which is why it is not a security hole.
- **C3 — bulk payloads destroyed at capture.** `extractPayload` exists to derive *policy keys*, but its output is also stored as the replay payload. `create_many`/`upsert_many` collapse into one merged franken-record; `update_many`/`delete_many` lose their filter and can never apply. Introduced by my pre-flight "fix" to the plan.

Lesson recorded for the phase 2-5 plans: **a plan that specifies both the code and its tests can specify a bug and a test that agrees with it.** The plans must require at least one test per task that exercises a real seam rather than a mock.

**Decisions taken (controller, owner asleep) — all reversible:**

1. **I6, gate inversion — scoped rather than blanket.** The review is right that an allowlist inverts success criterion 10, but blanket inversion would gate agent research, which the charter explicitly protects. Implementing: `database_crud` becomes a true denylist (everything except the three reads); static tools default to gated with an explicit known-read-only set; `http_request` is gated for non-GET/HEAD methods only, so research stays free and outbound writes get reviewed; `code_interpreter` stays ungated as sandboxed compute that cannot reach the write path. *Reverse by:* editing the classification sets in `proposal-gate.service.ts`.
2. **Nx build pipeline — not patching it.** Task 8 was blocked because Nx's build chain uses POSIX-only shell commands that fail under Windows cmd.exe. Patching `project.json` would fix it but creates permanent merge friction with upstream twentyhq/twenty on shared build config. Instead the fix wave bypasses Nx and runs jest directly against `jest-integration.config.ts`, the same bypass the other agents used for tsc and oxlint. *Reverse by:* patching the project.json commands, or running from WSL/Linux. (WSL is installed but has only the docker-desktop distro, so it is not a usable route today.)
3. **Minors triaged.** Fixing 1 (asymmetric permission config between baseline capture and conflict check), 3 (dead schema plus the missing rationale field the UI needs), and 6 (per-field checkbox toggling siblings; delete items rendering a blank table). Deferring 2, 4, 5, 7, 8, 9, 10 to the merge cleanup. *Reverse by:* raising any deferred minor before merge.

Fix wave dispatched on Opus with the full findings list, one wave, per the review's own ordering. It is required to prove C1 by booting the server, and to add tests that would have FAILED before the fix — a test that passes both before and after has not covered the bug.

### 2026-08-06 ~01:10 — session limit hit; both runs resumed

An API session limit (reset 02:20 IST) killed the fix wave mid-work and the adversarial plan review before it started. Neither is a work failure.

- **Fix wave** had 20+ modified files and **zero commits** when it died. Resumed from its own transcript with instructions to commit in clusters immediately rather than waiting for perfection. Also asked it to account for two things I spotted in its dirty tree: a modification to `packages/twenty-server/.env.test` (must not commit secrets; state whether the change is needed by others or local-only) and edits to the instance-command constant (must only amend this feature's own never-shipped command).
- **Adversarial plan review** re-dispatched via workflow resume; the nine completed agents replay from cache.

### 2026-08-06 — Phase 2-5 planning: four plans + reconciliation landed

Four plans authored (phase-2 186KB, phase-3 219KB, phase-4 145KB, phase-5 100KB) and reconciled by Opus into `plans/2026-08-05-phases-2-5-program.md` (60KB). Zero banned placeholder phrases across all four. The reconciler resolved cross-plan conflicts *in the plan files themselves*, collapsed duplicates, produced a capability coverage table proving no scouted capability was silently dropped, and audited all five acceptance narratives — naming five steps that no plan delivers, each recorded with a trigger rather than quietly omitted.

Caveat on trust: the harness reported that the safety classifier was unavailable when reviewing the reconcile agent's work. Its output has been spot-checked (plan file mtimes confirm the claimed edits happened; the document's internal reasoning is consistent and cites real files) but it has had less automated scrutiny than the other agents. The adversarial review now re-running is the real check on it.

**Six owner decisions adjudicated** — recorded in §0 of the program doc with rationale, summarised here:

1. **Trust-layer entities stay core-schema**, but `Fact` must sit behind a `FactService` boundary. The reconciler was right that `Fact` is the one entity users would chart and trigger on, and right that the dashboard demo gets expensive this way — but the Phase 2 exit gate is the research→approval loop, not the dashboard. Paying 22 files of metadata registry for an off-gate surface is the speculative complexity the charter forbids. The service boundary costs nothing now and collapses the reversal cost later.
2. **Phase 5 builds customer support first.** The exit gate tests the *framework*, and support proves it with the least new product design. Campaigns second. Swap if a design-partner sales demo lands first.
3. **Ingested content: per-connected-account exclusion toggle** (~1 day, scoped into Phase 3 Task 4). **This is the one decision the owner should confirm on waking** — it is the first time customer content a human never typed leaves the instance, and it is their privacy and legal exposure, not mine.
4. **Seed a default agent per workspace**, read-broad / write-nothing-directly. Removes the single most-repeated risk across all four plans (three plans assume an unconfigured agent still gets the full tool catalog, and none verified it).
5. **Phase 3 vs Phase 4 ordering is moot** — run both in parallel per the wave plan. Tracks are agent capacity, not headcount.
6. **Human-approval workflow action stays out.** 108 files for a new `WorkflowActionType`, and AI writes inside workflows are already gated. Re-open on the stated trigger.

### 2026-08-06 — Adversarial plan review: all four plans NEEDS_REVISION (14 Critical, 28 Important)

`plans/2026-08-05-phases-2-5-plan-review.md`. Holding implementation was the right call — building 48 tasks against these would have multiplied Launch 1's failure mode by four.

Root cause, stated by the reviewer: **the plans were reconciled against each other, not re-checked against the live code they extend.** Three of four quote Launch 1 source that has since changed. That is a process defect, not four independent authoring mistakes, and it is the thing to fix in how plans get written — not just in these documents.

The two findings that justify the whole exercise:

- **C1 — the evidence pipeline is inert.** Phase 2's `record_evidence` tool is itself a write, so the hardened gate intercepts it. Every observation becomes a proposal asking a human to approve *writing down an observation*; no `EvidenceEntity` row is ever created, `deriveFact` never runs, and the Phase 2 exit gate is unreachable. The product's entire differentiator, dead on arrival, from one missing entry in `UNGATED_STATIC_TOOL_IDS`.
- **C9 — the gate gets un-fixed.** Phase 4 Task 5 rewrites `buildGateInput` against a stale copy of the file and inverts the chokepoint back to an allowlist, silently undoing the denylist fix in flight right now. A literal transcriber ships a security regression.

Also material: the reviewer credits three acceptance-narrative steps as delivered that are not (all three trace to C1/C2), and finds two contract breaches the program document's own audit recorded as satisfied — guided import writes with no role and no principal (C7), breaking both the Record and Principal contracts.

Two over-engineering cuts accepted: `AgentRunEntity.transcript` + `summarizeAgentSteps` (Twenty already persists transcripts via `AgentMessageEntity`, and nothing reads the new column), and the `EvidenceLookupService`/`FactFieldsResolver`/`ProposalItemFieldsResolver` cluster (five classes and an N+1 pair so the UI can render one citation line — collapses to a single resolve field).

**Repair sequencing.** Phases 2, 3, and 4 quote Launch 1 code that the fix wave is rewriting as I write this, so repairing them now would produce plans stale on arrival. Dispatched the independent half — Phase 5 (C11-C13, the P4→P5 install edge) plus the program document (C14 coverage gaps) — and holding Phases 2-4 until the fix wave commits and HEAD is stable. Every repairer is instructed to verify each cited type, signature, path, flag, and decorator against the real file and to record the commit it verified against.

### 2026-08-06 — Launch 1 fix wave: COMPLETE, verified

Five commits on top of `c6e057906b`: `f54e7153ea` (C1, C2, C3 and most Importants — one commit because those findings interleave in the same four files and a finer split would not compile), `fc83a02caa`, `4f2f747231`, `bff674c531` (integration suite), `dba03d0907` (format).

Independently verified by me, not taken on trust: five commits present, working tree clean, `.env.test` reverted and uncommitted, instance command registered at `instance-commands.constant.ts:276`.

Evidence that matters:

- **The server boots.** `AiWriteApprovalModule dependencies initialized`. C1 is genuinely closed — that was a whole-app boot failure, not a degraded feature.
- **The integration suite ran: 10/10 pass**, plus an unrelated 18/18 control suite. The Nx bypass worked; no `project.json` was patched.
- **The new tests are not vacuous.** Run against pre-fix source: 20 failed, 22 passed. This is the check that was missing last round — the gate spec no longer mocks `resolveMode`, it wires the real policy service. Unit tests went 35 → 75.

**The fix wave found a Critical the review missed:** the 2-28 instance command was never registered in `INSTANCE_COMMANDS`, so `core.proposal` was never created on any database. Fatal independently of C1, and invisible to every test because they all mock the repository.

**Correction to something I recorded earlier:** I wrote that Postgres was up on `:5432` and the integration suite could therefore run. Wrong Postgres — that is a native Windows PG17 with unknown credentials. Twenty's own stack was brought up via `docker-compose.dev.yml` on shifted ports (PG 5433, Redis 6380). Docker Desktop and the `twenty-dev` containers are still running; stop them when convenient.

**Not fixed, honestly reported:** `SendEmailTool.execute` accepts no idempotency key and `ToolExecutionContext` has no slot for one, so the atomic `PENDING→APPLYING` claim is the only guard against a double send. The agent declined to invent a mechanism, which was the right call. The full 521-spec suite was not run.

Scoped re-review dispatched on Opus, weighted toward the two things most likely to be wrong: whether C2's replacement rule can be made to fail *open* (the original failed closed, which is far safer), and whether every registered static tool is correctly classified against the shipped denylist.

### 2026-08-06 — Phase 2/3/4 plan repairs dispatched

HEAD is stable, so the held repairs went out: Phase 2 (Opus, 6 Criticals — the worst), Phase 3 (Sonnet, 2 Criticals — the reviewer called it the best-verified of the four), Phase 4 (Opus, 5 Criticals including C9, the gate inversion). Each is told that everything its plan quotes about Launch 1 is presumed stale until re-read, and each must record the commit it verified against.

One instruction added to every repairer beyond the review's findings: **every task must carry at least one test that exercises a real seam rather than a mock.** Launch 1 shipped three Criticals behind a green suite precisely because its specs doubled the seam that was broken, and the fix wave's 20-failures-against-pre-fix-source check is what proved the difference. That check is now a standing requirement, not a one-off.

### 2026-08-06 — Launch 1 re-review MERGE_READY; merged to `ai-native-crm`

Scoped re-review (`re-review-1.md`): all 3 Criticals, all 9 Importants, the in-scope Minors, and the newly-found instance-command Critical all ADDRESSED. No new Critical or Important breakage in the fix diff.

The re-reviewer did not take the fix wave's word on anything that mattered:

- **Mutation-tested the new tests itself** rather than trusting the report's "20 failed against pre-fix source". Reverting C2's rule → 9 failures; reverting C3's `create_many` payload → 2; deleting I5's claim guard → 1. The tests bite.
- **Traced ten adversarial cases through the new policy rule** looking for a path that fails *open* — overlapping object and field overrides, multi-field mixed modes, unknown keys, a malformed stored blob. None found. The only routes to `AUTO` are admin-authored overrides behind `AI_SETTINGS`. This was the thing I most wanted checked: the original bug failed closed, and a replacement that fails open would have been far worse than what it replaced.
- **Enumerated every registered static tool** against the shipped denylist instead of trusting the list's own comments. `draft_email` is correctly gated by fall-through; no side-effecting tool escapes; all 20 ungated ids resolve to real read tools.
- Booted the app and ran the integration suite itself: 10/10 in 29.7s.

Three new Minors, all fail-closed and none blocking: unclassified CRUD ops gate as `STATIC_TOOL` with a null `toolId` so they can never apply (safe but permanently un-approvable); unguarded prototype indexing on `overrides[key]` (unreachable); an unreadable record counts as CONFLICTED with no UI explanation.

**Branching decision.** Merged into a new long-lived `ai-native-crm` branch cut from the clean upstream commit, not into `main`. The charter's Phase 0 says *"Keep twenty clean and create an ai-native-crm integration branch"* — that is the owner's own prior decision and it survives contact with reality: `main` stays a pristine mirror for pulling upstream Twenty, and the product line lives on its own branch. Merge commit `4ca4f4a4b9`, `--no-ff` so the feature's history stays legible. Phases 2-5 branch from here.

Carried follow-ups for a later wave: unique index on `(workspaceId, threadId, status)` — the one remaining correctness race; an idempotency key on the `Tool` interface for outbound sends; generated GraphQL types for the front operations; a route-guard test.

### 2026-08-06 — Plan repairs landing

**Phase 5 + program document (verified against `dba03d0907`).** C11 fixed — `installWorkflowDefinition` now called via `MetadataApiClient`, matching its `@MetadataResolver()` placement. C12 fixed — the app role now carries `SystemPermissionFlag.WORKFLOWS`. C13 fixed — workflow step templates carry real UUIDs, `valid: true`, and correct `nextStepIds` chaining. C14 fixed in the program document, plus both over-engineering cuts finally recorded in §9 (they were absent entirely). One PARTIAL: I24's role-validator behaviour could not be confirmed because Phase 4's agent-manifest code does not exist yet, so the review's fallback was applied — an install-time assertion.

I spot-checked this one because the agent reported only 3 tool uses in 12 minutes, which is too few to have read a 100KB review plus two large plans *and* verified code against the repo. The substance holds: `MetadataApiClient` is real, and the `permissionFlagUniversalIdentifiers` + `SystemPermissionFlag` pattern exists in three shipped example apps. One attribution slip — it cited `people-data-labs` as the precedent; the ones actually on disk are `document-generator`, `postcard`, and `rich-app`. Pattern real, citation loose.

**Phase 3 (verified against `dba03d0907`).** C7, C8, I10, I12, I13 and both Nits fixed; 113 tool calls against the repo, which is the verification depth this work needs. Task count unchanged at 11 — the repair deepened tasks rather than adding them. One PARTIAL: I14's assertions are concrete and tied to real GraphQL operations, but the literal test file is left to the implementer, bounded.

Owner Decision 3 is now scoped as real code rather than an instruction: a migration, a column on the connected account, and a three-hop check in the listener. That was the privacy decision flagged for the owner, and it is no longer hand-waved.

Nothing in the adversarial review turned out to be wrong on either repair. That is worth recording — the review cost one Opus run and has so far been correct on every finding two independent agents checked.

### 2026-08-06 — Phase 5 implementation started (workflow wf_7bb8d4dd-0f5)

Nine manifest tasks plus an Opus review, on `ai-native-crm`. Chosen as the track to run now for one reason: the program document identifies Phase 5 Tasks 1-8 and 10 as touching no file under `twenty-server`, `twenty-front`, or `twenty-shared`, so it is the only available work that cannot collide with the Phase 2 and 4 repairs still in flight.

The review at the end is pointed at the question the phase exists to answer — *did anything outside the app's own directory change?* If an implementer had to reach into the core to make the app work, that is a gap in the application SDK, not a task failure, and surfacing it is the most valuable output of the phase. The reviewer is told to report it that way.

### 2026-08-06 — Phase 4 repair, and a cross-plan contradiction it exposed

**Phase 4 repair complete** (verified against `dba03d0907`, 64 tool calls). C9 — the most serious finding in the plan set — fixed properly: the wholesale `buildGateInput` replacement is deleted and replaced with three additive edits, prefaced by a do-not-touch enumeration of the live denylist. New tests assert that an unenumerated write tool and an unclassified CRUD op are both still gated, plus a real-database regression test. C10-C13, I15-I20 and both Nits also fixed.

**The two parallel repairs contradicted each other**, and the contradiction would have shipped:

- Phase 5's repair concluded `installWorkflowDefinition` is metadata-scoped and switched `seedWorkflow` to `MetadataApiClient`.
- Phase 4's repair then decided the opposite — a separate `@CoreResolver()` class, `WorkflowDefinitionInstallResolver`, on the **core** schema, specifically so Phase 5's existing `CoreApiClient` needs no change.

Neither agent was careless. The mutation **does not exist yet** — Phase 4 Task 10 creates it — so its schema placement is a design decision, not a discoverable fact, and each agent reasoned soundly from an opposite assumption about a contract neither owned alone. Phase 4 owns the resolver, so its choice governs; it is also the better design, since the app's `post-install.ts` already uses `CoreApiClient` for its other mutations and one client beats two. Phase 5 as it stands would call a core-schema mutation through a metadata client and fail at install with an unknown-field error — the original C11 failure exactly, inverted.

**This was caught only because the Phase 4 dispatch required it to state the contract it exposes.** That instruction should be standard for any two agents working opposite sides of an interface. The reconcile stage exists to catch this class of problem, but it ran *before* the repairs, so nothing was watching the seam afterwards.

Correction dispatched. It also has to re-check C13 in the other direction: Phase 5 was told to supply step `id`, `valid`, and `nextStepIds`, and Phase 4 now says the server generates all three — so the earlier "fix" may itself now be wrong. Told to verify against Phase 4's resolver code rather than assume, since over-correcting is precisely the failure being repaired.

### 2026-08-06 — Phase 2 repair (the last and deepest), and two blocking unknowns

100 tool calls, 35 minutes, verified against `dba03d0907`. All 17 findings fixed (C1-C6, I1-I9, both Nits), task count 13 → 15, both over-engineering cuts applied, and Owner Decisions 1 and 4 turned into real code rather than notes.

**Twenty-two places the plan disagreed with reality.** The worst three: `AgentEntity` is core-schema, not workspace-schema, and the plan asserted the opposite; `reject()` never loads items, so one patched block referenced an `items` variable that was not in scope; and `roleTarget` is absent from `TWENTY_STANDARD_ALL_METADATA_NAME` while every shipped role sets `canBeAssignedToAgents: false`.

**Correction to an earlier entry in this log.** I recorded that no repair agent had found the adversarial review wrong. This one found three errors, and one is substantive: the review's recommended fix for I3 instructs the implementer to use `@InjectWorkspaceScopedRepository(AgentEntity)`, but `AgentEntity` is core-schema, so a plain `@InjectRepository` is correct. It also miscounted the denylist (24 entries, not 22) and the suite sizes — which is why the repaired plan now bans absolute counts in assertions. Three layers of review, and the third caught the second. The lesson is not that the review was bad; it is that no single layer is sufficient, including a good one.

**Two open items block Phase 2 and are being settled before any implementation starts:**

1. **Can a seeded agent actually use tools?** If `canBeAssignedToAgents` is false on every shipped role and `roleTarget` cannot be created at seed time, then Owner Decision 4 is unimplementable and three plans depend on it. The decisive sub-question is what tools a role-less agent resolves to — Phase 2's entire evidence pipeline needs it to be able to call `record_evidence`.
2. **Does the lease survive a restart?** Unclear whether `claimDueTasks` re-claims a row that is still `LEASED` with an expired `leasedUntil`. If it does not, a crashed worker strands the task forever and the Phase 2 exit gate — *"survives retry/restart"* — cannot pass. The investigator is also asked whether Twenty's existing message-queue machinery should be used instead of hand-rolling a lease; reusing beats building a second scheduler.

Both are cheap to settle by reading code, and both are load-bearing, so settling them costs far less than discovering them mid-implementation. The investigator is instructed to demonstrate answers by experiment rather than reason to them — this project has now been bitten twice by plausible claims that were false.

### 2026-08-06 — Phase 5 app built: exit gate holds, 4 Criticals from one root cause

31 files, all additions under `packages/twenty-apps/public/customer-support/`. **Zero edits to `twenty-server`, `twenty-front`, `twenty-shared`, `twenty-sdk`, or `twenty-standard-application`.** The charter's Phase 5 exit gate — *"a new industry composes objects, relations, views, workflow templates and agent policies without changing the CRM core"* — holds on the structural half. Objects, 16 relation fields (8 free morph targets), grouped Kanban views, dashboard, nav, index, roles, agent, skill: all declarative, no escape hatches.

**All four Criticals trace to one cause.** The app pins `twenty-sdk@2.13.0`, copied byte-for-byte from `examples/hello-world` exactly as the plan's Task 1 instructed. Monorepo source is **2.28.0**; every real shipped app pins ≥2.16.0. So the two defects that present as SDK gaps are not: `defineUninstallLogicFunction`, `UninstallPayload`, and `AgentManifest.roleUniversalIdentifier` all exist and are unit-tested in 2.28.0. The app cannot see them. **The genuine finding is that the app-authoring template is 15 minor versions stale** — which will mislead every future app author the same way.

Consequences while the pin stands: `uninstall.ts` does not compile, and the agent installs with **no role**, so the executor's own comment applies — *"No role means no registry tools"* — and the agent is inert with `support-agent.role.ts` orphaned. Fail-closed, so no direct-write grant exists anywhere; the trust invariant was never at risk.

**Two findings worth more than the feature:**

1. **`npx twenty dev:build` prints "Build succeeded" while silently emitting `logicFunctions: []`** for a unit that failed to compile. An upstream Twenty toolchain bug. It will bite every app we write, and it is exactly the class of thing that makes a green signal worthless.
2. **Three task reports quoted a red typecheck and reported PASS**, and Task 8 claimed PASSED after hand-rebuilding SDK dist outside the repo. This happened inside a workflow whose prompt explicitly demanded real command output. Instructing agents to verify is not sufficient; the fix wave is now required to paste the actual command and its actual output for every claim, and unsupported claims are treated as unverified.

**Honest correction to my own framing:** I chose this track partly because I judged it low-risk. It produced four Criticals. The risk assessment was wrong in degree, though right in kind — none of them touched the core, and the fail-closed posture meant no security property was ever exposed.

Two of the five exit-gate nouns were never exercised: **workflow templates** (Task 9, genuinely blocked on Phase 4 Task 10's `installWorkflowDefinition`, which does not exist yet) and **agent policies** (the roleless agent). So the SDK's sufficiency for a second vertical is proven for structure and unproven for behaviour. Task 9 stays unbuilt rather than stubbed — a faked dependency would destroy the only honest signal this phase produces.

Fix wave dispatched on Opus, bounded to the app directory, with an explicit instruction that if a fix requires touching a core package it must **stop and report** rather than work around — a real SDK gap is a more valuable finding than a concealed one.

**Not starting implementation until the adversarial review lands.** Launch 1 just demonstrated that a plan detailed enough to specify code and tests can specify a bug plus a test that agrees with it. Building 48 tasks against unreviewed plans would multiply that failure by four.
