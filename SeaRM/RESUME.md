# RESUME — single source of truth for continuing this build

If anything stopped — host crash, session limit, closed laptop — start here. Every command is copy-paste ready.

## 1. What state are we in?

```bash
cd d:/Files/Vatsa/Projects/AI-CRM/searm
git log --oneline 6e1c710a7d..HEAD | wc -l     # commit count on the product branch
git log --oneline -8
git status --short                              # uncommitted work an agent left behind
```

Branch is `ai-native-crm`. Branch point is `6e1c710a7d`. **Never push** — no push remote exists by design, and `upstream` is Vatsa10/Harbour which must never receive these commits.

## STATE AT 2026-08-18 CHECKPOINT

**HEAD `de4a3004df`**, ~127 commits on `ai-native-crm`. Server typecheck **EXIT=0, zero errors**.

Landed this session:
- `4b1c1fe536` enterprise license gate -> always-on AGPL shim. **Server boots** (`Nest application successfully started`). Un-gates event logs, JWT signing-key rotation, SSO, emailing-domain for free.
- `78bd5618bf` `AgentRun` GraphQL surface: `agentRuns(agentTaskId: ID)` -> model, elapsedMs, tokens, `creditsUsedMicro` (BigInt), result/error. Mutation-checked. Front page has expandable per-run rows.
- `042453a32b` agent task cost ceiling; `2dd64fce0f` AI agent runs settings page; `6fffb5c2e0` workflow templates bound to a real agent + **any** unbound `AI_AGENT` step now refuses install.
- relationship-matching co-participant lane; `de4a3004df` typecheck fix.

**IN FLIGHT when this checkpoint was written** (direct agents, not workflows — no run IDs to resume; check `git log` and `git status` to see what they landed):
- Billing refactor + `usage` re-license (Sonnet). ~35 files. Must generate AND register an instance command for the `WorkspaceEntity` relation drop, and boot the server as proof.
- DNS/Cloudflare deletion (Haiku), `domain-manager` only.

**SHIP GATE NEVER RESUMED.** `wf_8260d7e4-15c` died at the 2026-08-17 session limit. `docs/LAUNCH-READINESS.md` is stale (Aug 17) and `.superpowers/sdd/final/` has no `contract-audit.md` / `execution-proof.md`. **This is the top remaining item** — it is the only thing that closes the open Criticals below.

**Still open, from the contract audit (unfixed):** `buildGateInput` returns null for `executionRef.kind === 'logic_function'`, `evaluate()` reads null as ALLOW, and `logic-function-tool.provider.ts:28-30` returns `isAvailable: true` unconditionally. The shipped `people-data-labs/enrich-person.function.ts` uses this path to overwrite Person fields. **1 of 19 AI write paths bypasses the gate.**

Enterprise sequencing (audit order): 1. shim DONE, 2. JWT+event logs FREE via shim, 3. billing IN FLIGHT, 4. DNS IN FLIGHT, 5. RLP rewrite (~25 files, AGPL `__tests__` specs are the contract) NOT STARTED.

---

## STATE AT SESSION LIMIT — 2026-08-17 ~21:30 IST

**120 commits** on `ai-native-crm`, working tree clean, HEAD `c5887634d7`.

The session limit stopped 9 of the ship gate's 10 agents mid-run. Nothing was lost — every agent commits within minutes and the collision audit's result is cached.

### Resume order when the limit resets

1. **Start Docker first.** It dies with the host every time, and two reviews have already reported environmental failures as code defects because the database was down.
   ```bash
   # start Docker Desktop, then:
   cd d:/Files/Vatsa/Projects/AI-CRM/searm
   docker compose -f packages/searm-docker/docker-compose.dev.yml up -d
   # wait for 5433 and 6380 to listen before dispatching anything
   ```
2. **Ship gate** — `Workflow({ scriptPath: "d:/Files/Vatsa/Projects/AI-CRM/docs/superpowers/final-verification-workflow.js", resumeFromRunId: "wf_8260d7e4-15c" })`
   The collision audit replays from cache. Contract audit, execution proof, up to 3 fix→re-verify rounds and the verdict all re-run. The three carried Criticals (C3 fact uniqueness, C4 dead research on upgraded workspaces, C5 model-asserted evidence) are named explicitly in the fix-round prompts.
3. **Enterprise removal** — `Workflow({ scriptPath: "C:/Users/Vatsa/.claude/projects/D--Files-Vatsa-Projects-AI-CRM-searm-packages-searm-server-src/96983ed1-4a2c-48b6-ae79-e19f7b4e4c93/workflows/scripts/searm-enterprise-rewrite-wf_51024019-0b3.js", resumeFromRunId: "wf_51024019-0b3" })`
   Audit, both specs and both implementations are DONE and cached. Only the removal phase remains: delete the 256 `@license Enterprise` source files now that row-level permissions are rewritten (6 commits, mutation-checked) and billing/SSO are dispositioned.
4. Then the rebrand, then cleanup and restructure.

### What the collision audit established (worth not re-deriving)

- 13 of 234 files in the concurrent window were touched by both runs. **12 clean, 1 damaged and already repaired.**
- The one real collision: my `git add -A` snapshot `3f6b1d6d72` rolled `hasFieldOverlap` back to `some(field => field !== undefined)`, silently turning field-level proposal supersession into record-level — a city edit would retire a pending jobTitle draft. Broken 02:34–11:46, restored by `cc20a662e6`, correct at HEAD.
- No duplicate implementations anywhere.
- Typecheck EXIT=0. Unit suite **8212/8253**, and every one of the 26 failures is in a file with **zero commits on this branch** — pre-existing Windows path-separator assumptions, not our defects.
- **Rule that came out of this: never `git add -A` while other agents hold files open.** Snapshot with explicit paths, or not at all.

---

## STATE AT END OF 2026-08-17 SESSION

**95 commits** on `ai-native-crm`, working tree clean, HEAD `3f6b1d6d72`.

**Done and verified:** the app boots; the 138-tool permission leak is closed; Phase 3's structured extraction shipped (the gap the coverage audit proved was missing); Phase 5's install/upgrade/uninstall gate passes; the inbound ingestion noise filter is in.

**All three Phase 4 Criticals fixed this session:**
- `e27f289890` data-model mutation tools put back behind `DATA_MODEL` — a permission escalation
- `c679ecbd1e` the denylist regression guard revived — the branch had been shipping with the one test protecting the gate red
- `84540261fe` the delete confirmation gate made *killable* — it had been provably a no-op under every runnable test

**Two `wip:` commits are floors, not designs** — snapshots taken so host death could not lose work. Neither is typechecked or tested. Whoever picks them up must finish and prove them:
- `8fac886b0a` auto-create policy and import dedup
- `3f6b1d6d72` proposal supersession, failure-envelope helper, gate spec updates

**Still open:** Phase 2's 5 Criticals and Phase 3's 3 Criticals, whose fix waves had not completed when the session ended. Reviews are at `searm/.superpowers/sdd/finish/phase-{2,3,4}-review.md`.

**Run status when the session ended:**
- `wf_326defb6-3fa` (main) — was ACTIVE mid fix-wave. Resume it first.
- `wf_478246e7-789` (porting) — parked for memory.
- `wf_51024019-0b3` (enterprise rewrite) — parked for memory. Its audit agent had died on an API `server_error`, so the audit must re-run before its specs mean anything.

**Tomorrow's order:** resume main → let it finish → launch the ship gate (`docs/superpowers/final-verification-workflow.js`, now an iterate-until-clean loop, all Opus) → resume porting → resume enterprise. Two runs maximum, always.

## HARD RULE: two runs maximum

This machine has 16GB. **Three concurrent workflows drove available memory to 323MB and 501MB on two separate occasions** — each time the host was minutes from an OOM kill. Two runs sit comfortably at ~3GB free.

Run at most two. When one finishes, start the next from the queue below. The enterprise rewrite (`wf_51024019-0b3`) is currently parked for exactly this reason and should be resumed as soon as a slot frees.

## 2. Resume whatever died

Completed agents replay from cache, so resuming is cheap and repeats nothing.

```
Workflow({ scriptPath: "C:\\Users\\Vatsa\\.claude\\projects\\D--Files-Vatsa-Projects-AI-CRM-searm\\96983ed1-4a2c-48b6-ae79-e19f7b4e4c93\\workflows\\scripts\\searm-all-remaining-wf_326defb6-3fa.js", resumeFromRunId: "wf_326defb6-3fa" })
```
Reviews of phases 2/3/4, their fix waves, nine carried defects, notification primitive, evidence dashboard, whole-branch review.

```
Workflow({ scriptPath: "C:\\Users\\Vatsa\\.claude\\projects\\D--Files-Vatsa-Projects-AI-CRM-searm-packages-searm-server-src\\96983ed1-4a2c-48b6-ae79-e19f7b4e4c93\\workflows\\scripts\\searm-porting-and-features-wf_478246e7-789.js", resumeFromRunId: "wf_478246e7-789" })
```
Three ported capabilities, record briefs, proposal supersession, stale sweep, apps to `workspace:*`.

```
Workflow({ scriptPath: "C:\\Users\\Vatsa\\.claude\\projects\\D--Files-Vatsa-Projects-AI-CRM-searm-packages-searm-server-src\\96983ed1-4a2c-48b6-ae79-e19f7b4e4c93\\workflows\\scripts\\searm-enterprise-rewrite-wf_51024019-0b3.js", resumeFromRunId: "wf_51024019-0b3" })
```
Audit, spec and reimplement billing / SSO / row-level permissions, then remove the 267 `@license Enterprise` files. Agents in this run are barred from reading those files — they write from our charter and from public standards (SAML 2.0, OIDC, Stripe's public API), because reading-then-reimplementing produces a derivative work. Deleting billing outright is an explicitly allowed conclusion and probably the right one.

## 3. When ALL THREE of the above are finished

```
Workflow({ scriptPath: "d:/Files/Vatsa/Projects/AI-CRM/docs/superpowers/final-verification-workflow.js" })
```
All-Opus end-to-end verification: collision audit between the two parallel runs, contract and narrative audit, execution proof with mutation sampling, one fix wave, then the go/no-go verdict and a rewritten `docs/LAUNCH-READINESS.md`.

## 4. After that, in order

1. **SeaRM rebrand** — `Workflow({ scriptPath: "d:/Files/Vatsa/Projects/AI-CRM/docs/superpowers/rebrand-searm-workflow.js" })`
   First: `git tag pre-searm-rebrand && git checkout -b rebrand/searm`. Merge back only on a `SAFE_TO_MERGE` verdict with test counts matching pre-rename.
2. **Cleanup** — `docs/superpowers/REMAINING-WORK.md` stage 7: delete merged branches with `-d` (never `-D`), remove the leftover worktree, and bundle the three reference repos before deleting them.

## 5. Environment gotchas that have cost real time here

- **Never run bare `npx jest`** — it defaults to 23 workers on this 24-core box and has OOM-killed the host three times. Use `cd packages/searm-server && bash ../../scripts/lowmem.sh test|itest|types|full [pattern]`.
- Postgres is on **5433**, Redis on **6380** (docker-compose.dev.yml). `:5432` is an unrelated native Windows Postgres that has already fooled two agents into thinking the database was up.
- Nx targets are broken on Windows here. Use `npx tsgo -p tsconfig.json --noEmit` directly.
- `npx eslint` has no resolvable flat config. If lint cannot run, say so — do not claim it passed.
- `searm dev:build` prints "Build succeeded" while silently dropping units that failed to compile. Inspect the built manifest.
- A `yarn install` now re-downloads ~3.3GB; the Yarn cache was cleared to reclaim disk.

## 6. Rules that do not lapse

- No push. No new remote without the owner.
- The five contracts in `docs/superpowers/PRODUCT-CHARTER.md` are not negotiable.
- No AI write path may bypass `ProposalGateService`.
- The three reference repos stay until their scout reports are archival-grade and they have been bundled.
- Never weaken a test to make it green. Verify fixes by mutation.
- Verify against disk, not commit messages — a task was once reported done here that had never been written.

## 7. Decisions still belonging to the owner

1. **Privacy** — ingested email and calendar content reaching a third-party LLM. Shipped with a per-connected-account exclusion toggle; still unconfirmed.
2. **Publishing** — creating a push remote. AGPL makes a public repo a distribution event with source-availability obligations.
3. **Deleting** `crm`, `crmkit`, `relaticle` — gated on bundling and on every DEFER row being self-contained.
