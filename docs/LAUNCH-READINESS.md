# Launch readiness — AI-Native CRM

**Assessed 2026-08-17** against branch `ai-native-crm` at HEAD `807fc8a4aa`, by reading source and the recorded task, review and audit output. Nothing was built, run or rebuilt for this assessment.

**Recommendation: NO-GO for a design-partner trial.** Reasoning in the last section. A narrower "yes" is available and is spelled out there.

---

## 1. What works and is proven

Each item here has a command, a live trace, or a file on disk behind it. Nothing is listed on the strength of a task report.

| Capability | Evidence |
| --- | --- |
| **AI cannot write to the CRM without an approval** | `ProposalGateService` is the first statement of `ToolExecutorService.dispatch()`, and it is a **denylist** — an unclassified tool is gated by default, so adding a tool cannot accidentally open a hole. Reviewed twice; the re-reviewer enumerated every registered static tool against the shipped list and traced ten adversarial policy cases looking for a route that fails *open* and found none. |
| **The evidence → fact → proposal → citation chain** | Proven by execution on a scratch database (`p2review`) with the real services and real SQL: `record_evidence` → `Evidence` row (with payload hash and strength) → derived `Fact` → `ProposalItem.factIds` → the citation projection the approval UI reads. A second workspace reading the same fact ids got `[]` — tenant scoping holds at the SQL layer, not just in application code. |
| **Durable task leases survive a crashed worker** | Proven by kill-and-watch, not by reasoning: `claimDueTasks` uses `FOR UPDATE SKIP LOCKED` with an `attempts < maxAttempts` guard and a `leasedUntil` compare-and-set, and a killed worker's task was re-claimed. Backoff, attempt exhaustion, guarded completion and explicit cancellation all exist with tests. |
| **Confirmation-gated AI deletes** | End-to-end integration test: an AUTO-policy `delete_one` with no token is refused and the record stays alive; the same call with the token succeeds; a token minted for record A is rejected for record B. Mutation-checked — deleting the branch makes exactly those two tests fail. |
| **Imports and connected-account events produce traceable, non-duplicating proposals** | All four clauses of the Phase 3 gate proven against a real database after a full reset: proposals carry a `sourceKey` (`import:<batchId>:<row>`, `ingestion:messageParticipant:<id>`), a replayed import job creates exactly one proposal, and a colliding `sourceKey` in another workspace neither suppresses nor is touched. |
| **Agent-safe failure envelopes** | `code` / `message` / `hint` / `allowed_actions` / `retryable` shipped through the tool executor and the MCP wire, with an integration test asserting a non-retryable `UNKNOWN_TOOL`. |
| **A vertical installs without touching the core** | The customer-support app is 31 files under `packages/searm-apps/public/customer-support/` with **zero** edits to `searm-server`, `searm-front`, `searm-shared`, `searm-sdk` or `searm-standard-application`. Independently checked by the phase review, and the fix wave was told to stop and report rather than reach into the core — it did. |
| **Cost accounting exists** | `AgentRun` records `elapsedMs`, input/output tokens and `creditsUsedMicro`, written by the task-run job; `AgentTask` carries a per-task step budget that the worker names in its outcome when hit. |
| **The app boots** | Verified 2026-08-08 at commit `9cdf25aa6c`: `/healthz` → `{"status":"ok"}`, `Nest application successfully started`, 161 routes, zero unresolved-dependency errors. **See §2 — this proof does not extend to HEAD.** |

---

## 2. What is built but unverified

This is the largest category, and it is the reason for the recommendation.

**HEAD itself has never been run.** The boot proof above is two commits old. Since then: `61b3d41714` (support app widget change) and `807fc8a4aa` (the security fix in §4). `node_modules` in the working checkout is currently empty — three entries, no `.bin` — so the agent that wrote the security fix could not run jest, could not run `tsgo`, and could not run eslint. It verified its new utility by executing that one file under `tsx` against seven assertions plus a mutation check, and said so plainly. **The provider edit and its new jest spec are unverified by execution.** No typecheck, no unit suite, no integration suite, and no boot has been performed at HEAD.

**The Phase 2 exit gate has never passed.** `agent-task-research.integration-spec.ts` (8 tests) is written, typechecks and lints. Its only recorded run returned `FORBIDDEN — "User is not a member of the workspace"` for all 8, against a database whose `core` schema had zero tables. So the following have never been observed: the GraphQL transport for research, the cron → BullMQ → worker hop, and an approval applying a change exactly once. The harness in §1 closes the service-and-SQL half of that gate and is genuine good news; it is not a substitute for the suite, and the instruction on record — *"Do not weaken the suite to make it pass"* — still stands.

**The external-agent path is untested where it matters.** Phase 4's nine green tests resolve services out of the booted app container. An external agent arrives over OAuth-scoped MCP, and that suite (`mcp-oauth-scoping`) last ran 2-of-4 red.

**Phase 5's install/upgrade/uninstall was never written.** The two test files the plan names do not exist. The app's workflow templates and post-install seeding have never been installed against a live workspace, so the two halves — the app's wire format and the server's install resolver — have been unit-tested against each other's shapes but have never met.

**No phase-level code review exists for Phases 3 and 4.** Phase 1 was reviewed twice, Phase 2 once (CHANGES_REQUESTED, no re-review), Phase 5 once plus a fix wave (no re-review). Phases 3 and 4 have had **zero**. On this project's own record, a first review has found 3–5 Criticals every single time it has run. Budgeting 8–12 undiscovered Criticals across those two phases is not pessimism, it is the observed rate.

**Nothing has ever been deployed against the target stack.** `docs/DEPLOYMENT-ENV.md` documents the Neon + Upstash contract carefully, but no instance has booted against Neon, no migration has run against Neon, and no BullMQ worker has connected to Upstash. The two risks that document flags — PgBouncer breaking prepared statements, and per-command billing against a polling worker — are unmeasured.

---

## 3. What is missing, and what it costs a user

| Missing | What it costs |
| --- | --- |
| **Structured extraction from email and call content** — the module exists and contains only the privacy toggle; there is no extraction service, no listener, no queue job, no LLM call | The entire *Inbox and meeting intelligence* narrative does not function. A user connects Gmail, sync runs, participants get matched — and no commitment, risk, job change or next action is ever extracted. The program document records this as built. It is not. The per-account privacy toggle built to protect it has **zero consumers**: a privacy gate in front of a feature that does not exist. |
| **Any way to start research from the product** | No workflow template calls `create_agent_task` (grep count: 0 across all three shipped templates), and `AgentTask` has no front-end at all — the resolver exposes `agentTasks`, `createAgentTask`, `cancelAgentTask` and no page consumes them. A user can only start the differentiating loop by asking the chat agent or by hand-writing a GraphQL mutation. |
| **Any way to watch research happen** | No UI for `AgentTask`, `AgentRun`, `Evidence` or `Fact`. Run history, budgets, retries and cost are recorded in Postgres and visible only via SQL. The charter's "durable agent runs with budgets, retries, auditability" is true of the data and false of the product. |
| **Notification that a proposal is waiting** | There is no in-app notification primitive in SeaRM; email is the only channel and it is wired for auth flows, not proposals. A reviewer learns a proposal exists by navigating to Settings → AI → Approvals and looking. In a trial this means the queue silently grows and the demo appears dead. |
| **The evidence / fact / AI-cost dashboard** | *Lead* narrative step 8, and the single best demo of the product's thesis — "here is what the AI believes and where it learned it". Not built. |
| **Record briefs; proposal supersession on situation change; stale-record sweep** | *Inbox* step 4, *Pipeline* step 5, *Monitoring* step 1. Deliberately cut with triggers; the triggers have since fired (the owner asked for all remaining features) and they remain unbuilt. Proposals expire on TTL only — a proposal made stale by a stage change stays in the queue asking for a change that no longer makes sense. |
| **Self-hosting, admin and security documentation** | Phase 4's documentation half. Only `AGENT_API_CONTRACT.md` and this repo's `DEPLOYMENT-ENV.md` exist. A self-hosting design partner has no runbook beyond the checklist appended to that file today. |
| **The Workflow Templates settings page is unreachable** | Routed at `SettingsPath.WorkflowTemplates` but absent from the settings navigation. Reachable only by typing the URL. |

One correction in the product's favour, recorded so it is not rediscovered as a gap: `Fact` freshness was planned as CUT and actually shipped, as a real `lastObservedAt` column.

---

## 4. Known defects still open

Ordered by what they cost.

1. **Approved ingestion proposals fail to apply.** Approving an `UPDATE_RECORD` proposal whose target is a `messageParticipant` with a `{ personId }` payload lands the item in `failedItemIds` inside `ProposalExecutionService.applyItem`, so the participant is never linked. The proposal is created correctly; the approval does nothing. The test naming this is deliberately left red. Compounding it: the item's own error text is swallowed rather than surfaced in the mutation result, so a user sees a failure with no reason.
2. **The 138-tool discovery leak — fixed, unverified.** A role with all `can*AllObjectRecords` flags false and zero object-permission rows was advertised the full CRUD tool catalog for every system object, because the catalog filtered on the *composed* permission map whose `isSystem => true` fallback grants read on every system object. Legitimate at the ORM layer, not legitimate as a discovery signal. The fix derives grants from what the role was actually granted and fails closed on an unknown role. It is committed at HEAD and **has not been run** (see §2). Until it is, treat the leak as open.
3. **Two read-then-insert races.** No partial unique index on `proposal (workspaceId, threadId, status)` or on `proposal.sourceKey` — both columns carry plain non-unique indexes today. Two concurrent agent turns, or two concurrent ingestion jobs, can each create a duplicate proposal. Same class; they should ship together.
4. **No idempotency key on the `Tool` interface.** `SendEmailTool.execute` accepts none and `ToolExecutionContext` has no slot for one, so the atomic `PENDING→APPLYING` claim is the only thing standing between a retry and a double send to a customer. The agent that hit this declined to invent a mechanism, which was correct.
5. **Unclassified CRUD ops are permanently un-approvable.** They gate as `STATIC_TOOL` with a null `toolId`, so they can never be approved. Fail-closed, and therefore safe, but the item is stuck in the queue forever with no route out.
6. **An unreadable record is reported as `CONFLICTED` with no UI explanation.** The reviewer sees a conflict and no reason for it.
7. **Unguarded `overrides[key]` prototype indexing.** Currently unreachable; still wrong.
8. **The front-end approval operations use hand-written `gql` documents consumed by untyped hooks**, where every other settings page uses generated types. No route-guard test for the approval inbox.
9. **`searm dev:build` reports success on a failed compile**, emitting `logicFunctions: []`. An upstream toolchain bug, not ours, but it will mislead every app author we onboard and it already produced four Criticals here.
10. **`AgentRun.workflowRunId` exists and is never written.** The charter's "workflow link" is structurally available and functionally empty.

---

## 5. The three decisions still sitting with you

None of these has been decided autonomously, and none should be.

**Decision 1 — ingested customer content going to a third-party LLM.**
The design answer is a per-connected-account exclusion toggle: a migration, a column on the connected account, and a check in the listener. The migration and the service shipped. **The feature they protect did not** — nothing calls the exclusion service, because the extraction that would send content to a model was never built. So the decision is currently costless and currently unconfirmed, and that is a comfortable place to make it rather than a reason to skip it. What you are deciding: when extraction is built, message bodies and call-recording content that no human at your company typed will leave your instance and go to your configured model provider. That is your privacy exposure and your legal exposure, not the project's. Confirm the default (opt-in per account vs opt-out) **before** the extraction feature is written, so it is built to the answer rather than retrofitted.

**Decision 2 — creating a push remote.**
No push remote exists, by design; `upstream` points at `Vatsa10/Harbour` and must never receive these commits. SeaRM is AGPL, so **publishing a public repository is a distribution event** and triggers source-availability obligations — which, since you intend to keep the source open, is a formality rather than a cost, but it is a formality with a date attached. The real consideration is that everything to date is local and reversible, and a push makes it neither. Weigh it against the fact that this machine has died three times, once losing 16 minutes of uncommitted work: a private remote is the cheapest disaster insurance available and carries none of the distribution consequences of a public one. Those are two separable decisions and only the public one is AGPL-relevant.

**Decision 3 — deleting the three reference repos.**
The gate defined for this has now largely been met. The capability audit walked all 101 rows of the coverage table against the disk: 47 shipped, 52 deliberately cut, 2 claimed-but-missing — and the audit judged the table 98% accurate. Of the two misses, one (`EvidenceSourceTypeGraphQL`) is a design that was consciously replaced by something simpler and merely undocumented; the other (structured extraction) is a real unbuilt feature whose source design lives in `crm-scout.md` row 25. **My recommendation: bundle, do not delete yet.** `git bundle create` per repo is a single file holding full history, restorable with `git clone`; it makes an irreversible act reversible for the cost of a few hundred megabytes. Delete the directories once the extraction feature is built, since that is the one BUILD NOW capability still drawing on a reference repo.

---

## 6. Go / no-go for a first design-partner trial

**NO-GO.**

The reasoning, in the order that matters:

1. **The thing you would be selling has never been demonstrated working.** The product's differentiator is the evidence → fact → proposal → approval chain. It works at the service layer — I would not dispute that, it was proven by execution against real SQL. But its exit gate has never run, no workflow starts it, and no screen shows it. A design partner cannot exercise the one capability that distinguishes this from SeaRM upstream. Putting it in front of a customer means demoing an approval inbox fed by a mutation you typed for them.
2. **HEAD is unrun.** The current commit has not been booted, typechecked, or tested, and one of the two commits on top of the last known-good state is a security fix whose verification could not execute. You do not know whether HEAD starts.
3. **Two phases have never been code-reviewed**, and the first review of every phase so far has found between three and five Criticals. Shipping Phases 3 and 4 unreviewed to an external user is accepting an unknown number of known-shaped defects.
4. **A user in a trial would hit the missing notification within a day.** Proposals accumulate in a settings page nobody is told to visit. The failure mode is not an error — it is the product appearing to do nothing.
5. **One known defect breaks the loop end to end**: approving an ingestion proposal fails silently at apply time.
6. **The target deployment stack has never been used.** First contact with Neon's pooled-endpoint behaviour and Upstash's per-command billing should not happen with a customer watching.

**What a smaller "yes" looks like, and I would support it:** an operator-driven demo on the existing dev stack, with you at the keyboard, showing the approval inbox with real citations, the gate refusing an unconfirmed delete, and a guided import producing traceable proposals. All three are genuinely proven and all three are impressive. That is a credible design-partner *conversation* without a design-partner *instance*.

**What has to become true for a real go**, roughly in cost order:

- Boot HEAD and run the full suite — server and front unit tests, both typechecks, integration with a database reset. Until this happens nothing else on the list can be trusted.
- Run the Phase 2 exit gate to completion without weakening it.
- Review Phases 3 and 4, one fix wave each, one scoped re-review each.
- Build the notification when a proposal lands, and one way to start research that is not a raw mutation — a workflow template calling `create_agent_task` is the cheapest.
- Fix the apply-time failure on relation-FK proposals, and add the two partial unique indexes.
- Deploy once to Neon + Upstash following the first-run checklist in `DEPLOYMENT-ENV.md`, and watch the Upstash command count for a week.

The evidence dashboard, record briefs, supersession and the sweep are all worth building and none of them is a launch blocker. The six items above are.

---

## 7. One thing worth saying about how this project has been run

The reason this document can be specific is that the process caught its own failures repeatedly and wrote them down: a plan that specified a bug and a test that agreed with it; three task reports that quoted a red typecheck and reported PASS; a green suite over a two-way-broken DI graph; a review that was itself wrong on three points and was caught by the layer after it; a commit message that described work never written. Each of those is recorded, in the project's own words, in `OVERNIGHT-LOG.md`.

That record is why "verify against disk, not against reports" was the right instruction, and it is the only reason a NO-GO can be argued from evidence rather than from caution. The engineering here is better than the launch state suggests. The gap is not quality — it is that the last mile of proof, and the small amount of product surface that turns proven services into something a person can use, have not been done.
