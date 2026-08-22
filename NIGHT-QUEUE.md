# NIGHT QUEUE — autonomous execution to a working product

Goal: a user can log in, see records, edit one, and run an AI flow that
produces a gated proposal. Everything below serves that.

**Any session picking this up: work top-down. Verify against disk, never
against commit messages. Commit incrementally with explicit paths.**

## RULES THAT DO NOT LAPSE
- Never `git add -A` / `git add .` — a broad stage silently reverted a fix for 9h once.
- Never bare `npx jest` — 23 workers on 24 cores, has OOM-killed this host 3x.
  Use `cd packages/searm-server && bash ../../scripts/lowmem.sh test|itest|types [pattern]`.
- Postgres **5433**, Redis **6380**. `:5432` is an unrelated native Windows PG.
- Global `yarn` is BROKEN (`Cannot find module ...yarn.js`). Use
  `node .yarn/releases/yarn-4.13.0.cjs` or call node scripts directly.
- Clean-room: `grep -l "@license Enterprise" <path>` before opening ANY file,
  across packages including searm-shared. Never head/cat/sed/Read unverified.
  Read-then-DELETE is safe; read-then-REWRITE contaminates.
- Never weaken a test to make it green. Mutation-prove every fix: break it,
  confirm RED, restore, confirm GREEN, paste both.
- Never push. No new remote without the owner.

## P0 — PROVE IT RUNS (highest value, blocks honest claims)
1. Server boots: `NODE_ENV=development npx nest start` -> literal
   `Nest application successfully started`. Boot found a real bug typecheck
   and unit tests both missed (fa90b15b15). Boot after every wave.
2. Frontend dev server: `npx nx start searm-front`. Earlier failure blamed on
   rimraf quoting was MISDIAGNOSED — `npx rimraf dist` runs clean. Re-diagnose.
3. Front typecheck: was 14 errors. Drive to 0.
4. Browser round trip: "Continue with Email" + prefilled creds ->
   login -> record list -> open record -> edit field -> Settings ->
   Settings > AI > AI agent runs. Record console errors + failed requests.
5. Integration tests: `lowmem.sh itest`. DB is initialised now, so these can
   finally run. Report real counts.

## P1 — THE PRODUCT (8/27 narrative steps; this IS SeaRM)
Charter: docs/superpowers/PRODUCT-CHARTER.md. Audit: searm/.superpowers/sdd/final/contract-audit.md
6. No shipped workflow creates an AgentTask. `create_agent_task` exists as an
   action tool and `createAgentTask` is exposed, but no WORKFLOW_TEMPLATE uses
   it and there is no CREATE_AGENT_TASK step type. Ship one.
7. `deriveFact` is unconditional; `strength` is copied but never branched on.
   Strong non-conflicting -> Fact; weak or conflicting -> ProposalItem.
8. `EXTRACTABLE_PERSON_FIELDS` is `['jobTitle']` — 1 of 4 named categories.
9. `record-scope/` — 11 files, ZERO production consumers. Wire it or delete it.
10. Phase 5 install/upgrade proofs never run: `vitest.config.ts:15`
    `include:['src/**/*.test.ts']` excludes them. Fix the glob, run them.
11. Principal contract: event-logs now carries `actorKind`/`proposalReference`
    but NO emitter populates them. An approved AI change is still
    indistinguishable from a hand edit. Populate at the emit sites.
12. `SendEmailTool` has no idempotency key (carried defect 3.3).
13. Workflow templates are unversioned.

## P2 — LICENSING (21 files, then AGPL-clean)
14. `metadata-modules/row-level-permission-predicate` (15) + 
    `flat-row-level-permission-predicate` (6). Agent a753ef064 dispatched.
    `validate-row-level-permission-rule-ownership.util.ts` has NO safe spec —
    its spec is itself Enterprise. Derive from call sites, write fresh.
    Entities are a LIVE schema surface now — introspect 5433 and match.
15. `core-modules/sso` (4) + `core-modules/auth` (3): needs
    `findSSOIdentityProviderById` + `validateSAMLResponse` on SSOService.
    Contract: .superpowers/sdd/enterprise-rewrite/sso-spec.md
    KNOWN BUG: circular import in sso entity breaks any Jest spec touching
    ClickHouseService. Typechecks fine, fails at module resolution.
16. JWT rewrite has NO negative tests — required: alg:none, wrong key,
    expired, wrong issuer/audience, retired-key-still-verifies,
    revoked-key-does-not. Mutation-prove.
17. `test/integration/.../rotate-signing-keys-cron-job.integration-spec.ts`.

## P3 — REBRAND (only after P0 green)
18. `git tag pre-searm-rebrand && git checkout -b rebrand/searm`, then
    docs/superpowers/rebrand-searm-workflow.js. Merge only on SAFE_TO_MERGE
    with test counts matching pre-rename.

## P4 — HYGIENE
19. Delete stale branches with `-d` never `-D`: worktree-wf_ada1d4c2-ba1-{1,2,5,6}.
20. Create `ref/`, move crm + crmkit + relaticle into it, gitignore it.
    BUNDLE FIRST: `git bundle create ../<repo>.bundle --all`. Do not delete
    the three reference repos — that is an owner decision.
21. Move `docs/` inside the repo.

## OWNER DECISIONS — DO NOT DECIDE THESE AUTONOMOUSLY
- Privacy: ingested email/calendar content -> third-party LLM.
- Creating a push remote (AGPL = distribution event).
- Deleting the 3 reference CRMs.
- Apps distribution (`portal:`/`file:` recommended; `workspace:*` was wrong).
- Clean-room legal sign-off. 7 disclosures logged in
  .superpowers/sdd/enterprise-rewrite/CLEAN-ROOM-DISCLOSURES.md
