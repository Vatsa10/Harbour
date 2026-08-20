# Remaining work queue — autonomous execution

## EXECUTION MODEL (read this first)

Hardware reality: 16 GB RAM, ~1 GB available under load, three host deaths already caused by concurrent builds. A single `npx jest` defaults to 23 workers here and a `tsgo` run holds ~1.7 GB.

**Two lanes. Only one of them costs memory.**

| Lane | Concurrency | Content | Measured cost |
| --- | --- | --- | --- |
| **A — heavy** | **strictly 1 agent** | Anything that compiles, tests, boots, or migrates | 1.7-3 GB per agent |
| **B — free** | 1-2 agents | Reading source, writing markdown: rename map, scout deepening, docs, audits | ~40 MB total, measured by stopping both |

Lane B was stopped once to relieve memory pressure and freed only 39 MB — proof it is not the problem and can run continuously beside Lane A.

**Lane A order** (dependency-forced, not preference):

1. Boot fix — nothing downstream verifies until HEAD starts
2. Permission leak (138 tools to a zero-permission role) + red unit suite
3. Phase 5 completion (T9 seed, T11 install gate)
4. Phase 3 Task 4 extraction service + the red integration test
5. Reviews: Phase 2, then 3, then 4 — none reviewed yet
6. One fix wave per phase, each followed by a scoped re-review
7. The nine carried defects
8. Whole-branch review + one fix wave
9. Cut features (notification primitive, evidence dashboard, briefs, supersession, sweep)
10. SeaRM rebrand — LAST among code work, or every review diff becomes unreadable
11. Branch and repo cleanup

**Lane B runs continuously**, feeding Lane A: rename map and branding inventory (makes step 10 instant), scout report deepening and capability audit (gates repo deletion), charter update and launch-readiness doc.

**Crash resilience** — three host deaths so far, one costing 16 minutes of uncommitted work:

- Every agent commits per sub-item, never batched at the end.
- This file is updated after each completion, so a compaction or crash resumes from the queue plus `git log` rather than memory.
- A monitor samples available memory and warns below 1.2 GB before the host dies rather than after.
- Verify completion against disk, never against commit messages.

**Checkpoints where the owner is told something** — not asked, just informed: after boot lands, after the three reviews return their Critical counts, after the whole-branch review, and before the rebrand executes.

---


Owner standing instruction (2026-08-06): *"all remaining issues, bugs and features should be done now next after this three are done, i dont need to type in prompts again."*

This file is the durable queue. It survives context compaction and process death. **If you are a Claude instance resuming this work: read this top to bottom, check state against git, and continue at the first unfinished item. Do not wait for the owner to prompt.**

Guardrails that never lapse, regardless of what the queue says:
- No `git push`. No push remote exists; `upstream` is twentyhq/twenty and must never receive these commits.
- The five contracts in `PRODUCT-CHARTER.md` are not negotiable.
- No AI write path may bypass `ProposalGateService`.
- The three reference repos (`crm`, `crmkit`, `relaticle`) are not deleted.
- Exit gates are never weakened to make them green. A red gate honestly reported beats a green one that proves nothing.

---

## Stage 1 — in flight

| # | Item | Run | Done when |
| --- | --- | --- | --- |
| 1.1 | Phase 2 exit gate + Opus review | `wf_fbef3ab4-a82` | Review verdict recorded |
| 1.2 | Phase 4 exit gate | `wf_8607e575-d47` | Gate passes or BLOCKED with evidence |
| 1.3 | Phase 3 exit gate | `wf_78a0c6ca-23d` | Gate passes or BLOCKED with evidence |
| 1.4 | Phase 5 T9 + T11 | `wf_a0fa6ff9-2de` | Install/upgrade/uninstall proven |

If any run dies silently, resume it: `Workflow({scriptPath, resumeFromRunId})` — completed agents replay from cache.

## Stage 2 — code reviews (NONE of these phases has been reviewed)

Phase 1 review found 3 Criticals; its fix wave found a 4th. Phase 5's review found 4. **Phases 2, 3 and 4 have had zero code review.** Expect 8-12 Criticals across them. One Opus review per phase, then ONE fix wave each, then one scoped re-review.

| # | Item | Depends on |
| --- | --- | --- |
| 2.1 | Phase 3 whole-phase review → fix wave → scoped re-review | 1.3 |
| 2.2 | Phase 4 whole-phase review → fix wave → scoped re-review | 1.2 |
| 2.3 | Phase 5 review of T9/T11 → fix wave | 1.4 |

Every review must check: can any AI path write a CRM record without passing the gate; are the five contracts satisfied; and are the tests non-vacuous (verify by mutation — revert a fix, confirm its test fails).

## Stage 3 — carried defects and follow-ups

Real, known, and each one already has a diagnosis. None is speculative.

| # | Item | Origin |
| --- | --- | --- |
| 3.1 | Partial unique index on `proposal (workspaceId, threadId, status)` — read-then-insert race lets one agent turn create two proposals | Launch 1 re-review M2 |
| 3.2 | Partial unique index on `proposal.sourceKey` — concurrent ingestion jobs can double-create | Phase 3 T1 report |
| 3.3 | Idempotency key on the `Tool` interface — `SendEmailTool.execute` accepts none, so the `PENDING→APPLYING` claim is the only guard against a double send | Launch 1 fix wave, could not fix |
| 3.4 | Unclassified CRUD ops gate as `STATIC_TOOL` with a null `toolId`, so they can never be approved — fail-closed but permanently stuck | Launch 1 re-review N1 |
| 3.5 | Unreadable record counts as CONFLICTED with no UI explanation | Launch 1 re-review N3 |
| 3.6 | Unguarded `overrides[key]` prototype indexing | Launch 1 re-review N2 |
| 3.7 | Generated GraphQL types for the front operations — hand-written `gql` documents consumed by untyped hooks; every other settings page uses generated ones | Launch 1 review M5 |
| 3.8 | Route-guard test for the approval inbox | Launch 1 review I9 |
| 3.9 | Deferred minors M4, M7, M8, M9, M10 from the Launch 1 review | Launch 1 review |

3.1 and 3.2 are the same class and should ship together.

## Stage 3b — capabilities the program cut with a WRONG trigger (found by the coverage audit, 2026-08-17)

The audit verified all 101 scouted capabilities against symbols actually on disk rather than trusting the coverage table. Three were cut on reasoning that does not hold. These are not new features — they are correctness gaps in work already marked BUILT.

| # | Capability | Why the cut was wrong |
| --- | --- | --- |
| 3b.1 | **`SuppressedDomain` / `SuppressedContact`** (crm #26) | Mis-scouted as outbound do-not-contact lists and cut with the trigger *"when outbound send workflows are built"* — a trigger that can never fire for what they actually are. Grep shows their only consumers are the Gmail and Calendar sync services: they are the tenant-editable layer of an **inbound ingestion noise filter** (~32 automated local-parts, opaque/UUID local-parts, ~21 free-email domains, machine domains). Phase 3 ingestion is BUILT and **will mint junk contacts without them.** This is a Phase 3 prerequisite, not a deferral. |
| 3b.2 | **Auto-create policy decisions** (crm #25) | Program says "BUILT on Twenty's existing entities; nothing new modelled". True of the entities, false of the policy. Three decisions were silently dropped: the `autoCreate && repliedTo` reciprocity gate (never mint a record for a thread we have not ourselves replied to), "no company and no contact matched ⇒ drop the message entirely", and thread-linkage resolved once at thread creation. |
| 3b.3 | **Intra-import Create→Update dedup promotion** (relaticle) | Cut with trigger *"when a real import creates two records for one entity"* — i.e. a known correctness bug scheduled to be discovered by a customer. It is an in-memory normalised-value→new-id map consulted during the execute pass, roughly ten lines, and it is the difference between resolve-matches-once-up-front being correct and being wrong for any CSV containing the same new entity twice. |

Also recorded by the audit:

- **M1 — Phase 3 Task 4 was claimed BUILT and is not.** `modules/structured-extraction/` contains only the privacy toggle. No extraction service, listener, or job. `EMAIL_MESSAGE` and `CALL_RECORDING` evidence source types have **zero producers**, and `AiExtractionExclusionService` is exported with **zero consumers** — a privacy gate shipped in front of a feature that was never written. Currently being built by the `p3-extraction` agent.
- **M2 — `EvidenceSourceTypeGraphQL` never registered.** Deliberately superseded by a flat `facts{...sourceType}` projection with an in-code rationale, which is the better design — but no document records the substitution, so the program doc still sends readers hunting for a rejected component. Documentation fix only.

## Stage 4 — the five cut narrative steps

Deliberately cut with triggers during planning, because the charter's KISS rule forbids building unrequested capability. The owner has now asked for all remaining features, which is the trigger. Build in this order — the first two are the ones a first demo actually needs.

| # | Item | Why it matters |
| --- | --- | --- |
| 4.1 | **In-app notification when a proposal lands** | There is NO notification primitive in Twenty — email only. Without this a reviewer never learns a proposal is waiting. Build the primitive, then use it. |
| 4.2 | **Dashboard over evidence / facts / AI cost** | *Lead* narrative step 8. This is the demo: "here is what the AI believes and where it learned it." Note: materially cheaper if `Fact` becomes a standard object — see Owner Decision 1, which chose core-schema with a `FactService` boundary precisely so this stays a one-module change. |
| 4.3 | Record briefs | *Inbox* step 4. Substrate exists; the narrative panel does not. |
| 4.4 | Proposal supersession on situation change | *Pipeline* step 5. Today there is only TTL expiry. |
| 4.5 | Stale / high-value record selection sweep | *Monitoring* step 1. Lease machinery exists; nothing decides what to sweep. |

## Stage 5 — integration

| # | Item |
| --- | --- |
| 5.1 | Whole-branch Opus review across all five phases, high effort, pointed at the deferred-minor and parked lists |
| 5.2 | ONE fix wave for its findings, then one scoped re-review; adjudicate residuals |
| 5.3 | Full suite: `npx jest` server + front, both typechecks, integration with db reset |
| 5.4 | Update `PRODUCT-CHARTER.md` delivery table to reflect what actually shipped |
| 5.5 | Report to the owner: what works, what is unverified, what was cut and why |

## Stage 6 — SeaRM rebrand (owner-approved, full rename)

Runs **only after Stage 5** — renaming during unreviewed code churn would make every review diff unreadable.

Owner decision on record: **full rename, everything.** Packages, scope, imports, CLI binary, Docker, docs, product strings. The owner was told and accepted the consequence: after this, upstream Twenty merges conflict in nearly every file, so we own maintenance. The `upstream` remote stays configured (they did not choose to cut it), but treat pulling from it as a project, not a routine.

Launch with:
```
Workflow({ scriptPath: 'd:/Files/Vatsa/Projects/AI-CRM/docs/superpowers/rebrand-searm-workflow.js' })
```

**Survey complete (2026-08-17).** Map at `twenty/.superpowers/sdd/rebrand-searm/rename-map.md`, branding inventory beside it. 20 packages, dependency order established, and three repo-wrecking landmines found and folded into the execution script.

**One of them is a hard blocker the owner must resolve before the rebrand can finish:** the 19 packages under `packages/twenty-apps` pin `twenty-sdk` / `twenty-client-sdk` at **published registry versions**, not `workspace:*`. Renaming those two packages before `searm-sdk` exists on npm makes every app un-installable and breaks 6 CI workflows. Three ways out — publish under the new scope first, convert the apps to `workspace:*`, or keep the two SDK package names unrenamed for now. This is a distribution decision, not an engineering one.

**The `workspace:*` plan was WRONG and is withdrawn (2026-08-17).** The controller decided to convert the 19 apps to `workspace:*` rather than publish. An agent attempting it found the structural reason that fails and stopped rather than forcing it: every app under `twenty-apps` ships its own isolated `.yarnrc.yml`, `yarn.lock` and `npmPreapprovedPackages` **by design**, so it can be installed, tested and deployed standalone. Six CI surfaces depend on that — `install-twenty-app`, `deploy-twenty-app`, `test-twenty-app`, `spawn-twenty-app-dev-test`, and `ci-twenty-apps.yaml` all `cd` into an app directory and run an immutable install against that app's own lockfile. `workspace:*` breaks all six. Report: `twenty/.superpowers/sdd/porting/searm-apps-workspace-conversion-report.md`.

Three real options, in the controller's recommended order:

1. **`portal:` / `file:` references into the built `dist/`** — preserves per-app isolation and the standalone install model, needs no registry, and keeps the six CI surfaces working. This is the recommendation: it is the only option that changes nothing about how apps are distributed.
2. **Publish `searm-sdk` / `searm-client-sdk` under the new scope first.** Clean, but it is an outward-facing distribution act and therefore the owner's call, not the controller's.
3. **Rewrite the six CI surfaces to install from the repo root.** Largest blast radius, and it discards the isolation the design deliberately bought.

Until one is chosen, the rebrand can rename everything EXCEPT `twenty-sdk` and `twenty-client-sdk`. That is a coherent partial state — the apps keep working, and those two packages get renamed when the distribution question is answered.

**Before launching, do these three things:**
1. `git tag pre-searm-rebrand` on `ai-native-crm` — the restore point.
2. `git checkout -b rebrand/searm` — the rename never touches `ai-native-crm`.
3. Confirm the working tree is clean and all Stage 5 fixes are merged.

The workflow is Opus survey → five sequential Sonnet waves (shared/ui/emails → server → front → tooling → surface) → Opus verification. Sequential because every wave must leave the tree compiling for the next.

The script carries a **do-not-touch list** covering the eight categories that are persisted, identity-bearing, or legally required: universal identifier UUIDs, Postgres schema names, table and column names, shipped instance commands, GraphQL type and field names, persisted enum values, the standard application identity, and the AGPL LICENSE plus Twenty's copyright headers. Renaming any of them corrupts live workspaces or breaks the licence. The survey agent must settle the standard-application question by reading the lookup code rather than guessing.

Merge `rebrand/searm` into `ai-native-crm` only on a `SAFE_TO_MERGE` verdict with test counts matching pre-rename. Otherwise delete the branch and retry — that is what the restore point is for.

## Stage 7 — consolidation and cleanup

Runs **last**, after the rebrand is verified and merged. Owner instruction: collapse to one repo, and delete the reference CRMs only once every good feature has been extracted.

### 7a — branch cleanup (safe, mechanical)

Current branches, with the verdict for each:

| Branch | Action | Why |
| --- | --- | --- |
| `ai-native-crm` | **keep** — the product line | |
| `main` | **keep** | Pristine upstream mirror at `6e1c710a7d`. Costs nothing and is the only way to diff against unmodified Twenty when debugging "did we break this or was it always like that". |
| `ai-write-approval` | delete once confirmed merged | Superseded by merge commit `4ca4f4a4b9` |
| `worktree-wf_ada1d4c2-ba1-{1,2,5,6}` | delete | Scratch branches from Launch 1's parallel worktrees, all merged |
| `rebrand/searm` | delete after merging | Keep the `pre-searm-rebrand` tag |

```bash
cd twenty
git branch --merged ai-native-crm            # confirm before deleting anything
git branch -d ai-write-approval worktree-wf_ada1d4c2-ba1-1 worktree-wf_ada1d4c2-ba1-2 \
              worktree-wf_ada1d4c2-ba1-5 worktree-wf_ada1d4c2-ba1-6
```

Use `-d`, never `-D`. If git refuses, the branch holds unmerged commits and you need to find out why before forcing it.

Also remove the leftover verification worktree once Phase 4 is finished:
```bash
git worktree list                 # expect twenty + twenty-p4-verify
git worktree remove ../twenty-p4-verify
```

### 7b — deleting the three reference CRMs

**Gate: do not delete until all three conditions hold.** The owner's instruction is explicit — extraction first.

1. **Every BUILD NOW capability is shipped.** The program document's §6 capability coverage table lists every item from all four scout reports with a disposition. Walk it. Each BUILD NOW row must point at a task that exists in git.
2. **Every DEFER row is self-contained.** A deferred capability is only safely deletable if its scout report captures the design well enough to rebuild without the source repo — data model, control flow, and the decision worth keeping. Where a row is just a name, go back to the repo and deepen the report **before** deleting it. This is the step most likely to be skipped and most expensive to regret.
3. **Bundle before deleting.** Cheap, and it makes an irreversible act reversible:

```bash
cd d:/Files/Vatsa/Projects/AI-CRM
for r in crm crmkit relaticle; do
  git -C "$r" bundle create "../$r.bundle" --all
  git -C "$r" log --oneline -1        # record the commit the bundle captures
done
```

A bundle is a single file holding full history; `git clone crm.bundle` restores it. Store the three bundles somewhere outside the working tree before removing the directories.

Only then:
```bash
rm -rf crm crmkit relaticle
```

Final root layout: `searm/` (the renamed product repo), `docs/`, and the three `.bundle` files.

### 7b-2 — final directory structure (owner-directed, 2026-08-17)

Target:

```
AI-CRM/
├── searm/          the product repo (renamed from twenty). The only thing pushed.
│   ├── packages/
│   └── docs/       moved INSIDE, so a clone carries its own reasoning
├── ref/            crm, crmkit, relaticle + their .bundle files
└── RESUME.md
```

**`ref/` sits beside the repo, not inside it.** The owner asked for the three references in a `ref/` folder, gitignored. Putting them inside `searm/` and gitignoring works for git but not for the toolchain: Nx, jest, tsc and oxlint walk the directory tree rather than git's index, so three extra codebases inside the repo mean slower builds and occasional failures from a stray `package.json` or `tsconfig.json` being discovered. Keeping `ref/` outside needs no ignore rules at all and cannot be committed by accident. If it must live inside, add matching ignores to `nx.json`, every jest config, and `tsconfig.base.json` — not just `.gitignore`.

**Move `docs/` into the repo.** Today the charter, plans, scout reports and reviews sit outside the code they govern, so a clone gets the product with none of its reasoning. Move `AI-CRM/docs/` to `searm/docs/` and fix the paths in `RESUME.md` and the workflow scripts, which reference absolute doc paths.

### 7d — push, when the owner decides

No push remote exists by design. `upstream` points at twentyhq/twenty and must never receive these commits.

```bash
cd searm
git remote -v                                   # expect ONLY upstream
git remote add origin <your-repo-url>
git push -u origin ai-native-crm                # the product line
git push origin main                            # the pristine upstream mirror
git push origin --tags                          # includes pre-searm-rebrand
```

Before the first push, three things are worth being deliberate about:

- **AGPL-3.0.** A public repo is a distribution event. The LICENSE and Twenty's copyright headers must be intact, and modified source must stay available. A private repo triggers none of this.
- **Scan the history for secrets** before it leaves the machine. `.env.test` was edited and reverted during this build; confirm nothing else carries a credential.
- **Branch layout.** `ai-native-crm` is the product line and should probably become the default branch on the remote; `main` stays as the upstream mirror for diffing against pristine Twenty.

### 7c — what stays in docs

Everything under `docs/superpowers/` is the project's reasoning record: the charter, the specs, the plans, the scout reports, the reviews, and the overnight log. Keep it. The scout reports in particular become the *only* remaining record of what the three deleted repos knew — they stop being working notes and start being the archive.

## Stage 8 — owner decisions that stay open

**Do not decide these autonomously. Surface them and wait.**

1. **Owner Decision 3 — ingested customer content to a third-party LLM.** Implemented as a per-connected-account exclusion toggle. It is the owner's privacy and legal exposure, and they were asked to confirm on waking. Still unconfirmed.
2. **Pushing to a remote.** No push remote exists by design. Creating one and publishing is the owner's call, and AGPL means a public repo is a distribution event with source-availability obligations.
3. **Deleting the three reference repos.** Their scout reports are extracted, but the repos themselves stay until the owner says otherwise.

---

## Execution notes for whoever picks this up

- Verify task completion **against disk, not commit messages.** Commit messages have already lied here once — a task was reported done that had never been written.
- When two agents work opposite sides of an interface, make each state the contract it exposes. Three separate contract mismatches have happened on this project; every one was caught by that instruction, and the file-ownership rule that prevents collisions is itself what causes the drift.
- Do not trust a test because a plan wrote it. Three Criticals shipped here behind a green suite whose mocks doubled the broken seam, and a lease test asserted the exact wrong status. Verify non-vacuity by mutation.
- Paste real command output into reports. Agents on this project have reported PASS on a red typecheck, and one verification command (`tsgo` with no `include`) exited 0 unconditionally.
