export const meta = {
  name: 'searm-final-verification',
  description: 'End-to-end verification after the two parallel runs: collision audit, contract and narrative audit, execution proof, then one fix wave and a verdict',
  whenToUse: 'After both wh0ha1488 and wtk8vh1qf have completed',
  phases: [
    { title: 'Collision audit', detail: 'Did two parallel runs clobber each other', model: 'opus' },
    { title: 'Contracts', detail: 'Five contracts, five narratives, every AI write path', model: 'opus' },
    { title: 'Execution proof', detail: 'Boot, migrate fresh, all suites, all gates, mutation sampling', model: 'opus' },
    { title: 'Fix', detail: 'One wave for everything found', model: 'opus' },
    { title: 'Verdict', detail: 'Scoped re-review and the go/no-go', model: 'opus' },
  ],
}

const REPO = 'd:/Files/Vatsa/Projects/AI-CRM/twenty'
const DOCS = 'd:/Files/Vatsa/Projects/AI-CRM/docs/superpowers'
const WS = `${REPO}/.superpowers/sdd/final`
const BASE = '6e1c710a7d'

const COMMON = `
Repo: ${REPO}. Branch: ai-native-crm. Branch point ${BASE}. Never push.

Governing document: ${DOCS}/PRODUCT-CHARTER.md. Also read ${DOCS}/REMAINING-WORK.md and every review under ${REPO}/.superpowers/sdd/.

MEMORY: 16GB machine, OOM-killed three times. Never bare \`npx jest\` (defaults to 23 workers). Use:
  cd packages/twenty-server && bash ../../scripts/lowmem.sh test|itest|types|full [pattern]
Nx is broken. PG 5433 / Redis 6380; :5432 is an unrelated native Postgres.

THE STANDARD: paste the real command and its real output for every claim. This project's defining failure mode is a green suite over broken code — three Criticals shipped that way, hidden by mocks that doubled the exact seam that was broken. Assertions without evidence are treated as unverified.
`

const S = (extra = {}) => ({ type: 'object', properties: { status: { type: 'string' }, findings: { type: 'array', items: { type: 'string' } }, verification: { type: 'string' }, ...extra }, required: ['status'] })

// ── Two workflows edited one branch concurrently. Find what that cost.
phase('Collision audit')

const collision = await agent(`Audit whether two concurrently-running workflows damaged each other's work on this branch.

${COMMON}

Two runs edited \`ai-native-crm\` at the same time:
- one doing phase reviews, fix waves, carried defects, and two new features (notifications, evidence dashboard)
- one doing three ported capabilities, three narrative features, and an apps dependency conversion

They were told to re-read before editing, commit within minutes, and re-apply if overwritten — but that is mitigation, not proof. Both were expected to touch \`modules/guided-import/\` and \`engine/metadata-modules/ai/ai-research/\`.

Find the damage, if any:

1. **Identify overlap.** From \`git log --name-only\` over the concurrent window, list every file touched by commits from both runs. Interleaved commits touching one file are the risk set.
2. **For each overlapping file, verify the FINAL state is coherent** — not just that it compiles, but that both intended changes actually survived. A later commit silently reverting an earlier one is the failure mode; it leaves no conflict marker and no error.
3. **Look specifically for half-applied work**: an import added but its usage removed, a test updated for a signature that was then changed back, a module registration that no longer matches its provider, a migration registered whose entity was renamed.
4. **Check for duplicate implementations.** Two agents solving the same problem independently in different files is likelier than a merge conflict here — for example two suppression filters, or two notification paths.
5. Run \`bash ../../scripts/lowmem.sh types\` and the full unit suite. A collision usually surfaces as a type error or a suddenly-red unrelated test.

Write to ${WS}/collision-audit.md.

RETURN under 15 lines: how many files both runs touched, how many show damage, one line per damaged file with what was lost, and whether the tree is coherent.`, {
  label: 'collision-audit',
  model: 'opus',
  effort: 'high',
  schema: S({ overlapCount: { type: 'number' }, damaged: { type: 'array', items: { type: 'string' } }, coherent: { type: 'string' } }),
})

// ── The product promise, checked against the code rather than the plans.
phase('Contracts')

const contracts = await agent(`Audit the whole branch against the product charter. Judge the code, not the plans.

${COMMON}

1. **Trace EVERY AI write path end to end** and prove each passes \`ProposalGateService\`: agent chat, agent runs, MCP tools/call, execute_tool, workflow AI-agent nodes, ingestion listeners, structured extraction, guided import, the customer-support app's agent, and the stale-record sweep. For each, name the file and line where the gate is entered. **Any path that reaches a CRM record without it is Critical** — it is the single property this product sells.

2. **The five contracts**, verdict each with evidence:
   - Record: every action uses Twenty objects, fields, relations, permissions
   - Execution: versioned, idempotent, cancellable, leased, retryable, budgeted; a retry never duplicates a fact, notification, or record change
   - Evidence: no fact without a traceable observation
   - Proposal: visible diffs supporting approve, reject, expiry, supersession, batch execution
   - Principal: audit distinguishes user, represented user, workflow, agent, integration

3. **Walk the five acceptance narratives step by numbered step** (charter §"The end-to-end workflows the product must deliver"). For each step name the task and file that delivers it, or state that nothing does. Prior audits found steps credited as delivered that were not — verify by grep and execution, never by reading a plan.

4. **The capability coverage claim.** ${DOCS}/capability-coverage-audit.md lists what shipped versus what was cut. Spot-check at least ten SHIPPED rows against real symbols on disk. One task on this project was reported done that had never been written.

Write to ${WS}/contract-audit.md.

RETURN under 18 lines: per-contract verdict, count of AI write paths traced and any that bypass the gate, count of narrative steps delivered versus total, and any SHIPPED claim that failed the spot check.`, {
  label: 'contract-audit',
  model: 'opus',
  effort: 'high',
  schema: S({ contracts: { type: 'array', items: { type: 'string' } }, bypasses: { type: 'array', items: { type: 'string' } }, narrativeCoverage: { type: 'string' } }),
})

// ── Nothing counts until it runs.
phase('Execution proof')

const execution = await agent(`Prove the product actually works by running it. Reading code does not count in this phase.

${COMMON}

Do all of it and paste real output:

1. **Boot.** Start the server. Confirm the DI graph resolves and it listens.
2. **Migrate from empty.** Against a fresh database, run the instance commands and confirm the trust-layer tables exist: proposal, proposalItem, evidence, fact, agentTask, agentRun, plus the guided-import and notification tables. A migration registered but absent from INSTANCE_COMMANDS creates nothing while every test stays green — that already happened once here.
3. **Full unit suites**, server and front. Real counts.
4. **Every integration suite.** In particular the phase exit gates: evidence-to-proposal-to-approval with retry and restart, ingestion and import producing traceable proposals without duplicates or cross-workspace leaks, agent API semantics, and the customer-support app's install/upgrade/uninstall.
5. **Mutation sampling — the most important step.** Pick eight tests spread across the trust layer, ingestion, import, and the vertical app. For each: revert the code it covers, confirm the test goes red, restore. **A test that passes both ways has not covered anything.** Report the eight with their verdicts. This project has shipped three Criticals behind exactly this failure.
6. **The demo path, by hand.** Sign in, have an agent propose a change, see it in the approval inbox with its evidence citation, approve part of it, confirm the record changed and the audit names both agent and approver. That is the product; confirm a human can actually do it.

Write to ${WS}/execution-proof.md.

RETURN under 18 lines: boot yes/no, migration table list, suite counts, per-gate pass/fail, the eight mutation verdicts, and whether the demo path works end to end.`, {
  label: 'execution-proof',
  model: 'opus',
  effort: 'high',
  schema: S({ boots: { type: 'string' }, suites: { type: 'string' }, gates: { type: 'array', items: { type: 'string' } }, mutations: { type: 'array', items: { type: 'string' } }, demoPath: { type: 'string' } }),
})

// ── Iterate on Criticals until they are closed. A written complaint is not a product.
phase('Fix')

const SHIPPABLE = `
## THE BAR — this is what "shippable" means, and it is testable

1. The server boots and migrates cleanly onto an empty database.
2. Server and front unit suites are green. No skipped tests standing in for fixes.
3. Every phase exit gate passes against a real database.
4. **No AI write path reaches a CRM record without passing ProposalGateService.** Zero exceptions.
5. The demo path works by hand: an agent proposes, the write is intercepted, the proposal shows its evidence, a human approves part of it, the record reflects exactly that subset, and the audit names both agent and approver.
6. **Zero open Critical findings.** An Important may be deferred with a written trigger; a Critical may not.

Anything short of all six is not shippable, and saying so is more useful than a green sticker.
`

const fixRounds = []
let open = 'all findings from the three audits'

for (let round = 1; round <= 3; round++) {
  const f = await agent(`Fix wave ${round} of at most 3. Close the Critical findings — do not merely describe them.

${COMMON}
${SHIPPABLE}

Read, in order: ${WS}/collision-audit.md, ${WS}/contract-audit.md, ${WS}/execution-proof.md${round > 1 ? `, and ${WS}/reverify-${round - 1}.md which lists what round ${round - 1} failed to close` : ''}.

Currently open: ${open}

## THREE CARRIED CRITICALS — fix these even if this run's audits did not re-find them

The Phase 2 whole-phase review (${WS}/phase-2-review.md — read it) raised five Criticals. Two were environmental or stale. **Three are real, unfixed, and must be closed by this gate.** They are listed here because the audits above may not surface them independently.

**C3 — \`core."fact"\` has no uniqueness behind its one invariant.** The invariant is one CURRENT fact per (record, field). \`FactDerivationService.deriveFact\` reads \`findOne({status: CURRENT})\`, branches, then writes — with no lock and no constraint. Two concurrent \`record_evidence\` calls therefore create two CURRENT facts. This violates the Execution contract's "a retry must never duplicate a fact". Note \`agentTask\` already received a partial unique index for exactly this class of race and \`fact\` did not, so the fix shape is established in this codebase. Add the partial unique index AND make the derivation path safe against the race — an index alone turns a duplicate into a crash.

**C4 — durable research is dead on every workspace upgraded to 2.28.0.** The researcher agent and the AI Researcher role ship only through the declarative standard-application path, which runs at workspace creation. Existing workspaces never get them. There is no backfill workspace command. The repo has an established pattern for this — see \`upgrade-version-command/.../backfill-standard-skills.command.ts\`. **Worse than the missing backfill:** \`AgentTaskRunJob\` then runs a role-less agent, which resolves to zero registry tools, and records the run as **SUCCEEDED**. A silent no-op that reports success is worse than a failure. Fix both halves: write the backfill, and make a role-less or tool-less run fail loudly instead of claiming success.

**C5 — the evidence the product sells is model-asserted and never verified.** This is the product's central claim, so treat it as the most important of the three. The model supplies \`sourceType\` on \`record_evidence\`, and \`CRM_RECORD\` / \`CRM_ACTIVITY\` / \`MANUAL\` map straight to STRONG strength. The tool validates neither that the referenced record exists, nor that the field exists on it, nor that the source locator resolves. So "evidence-first" currently means "the model said so, at whatever strength it chose". Server-side verification is required: a claimed CRM-sourced observation must be checked against the actual record before it earns STRONG, and an unverifiable claim must be downgraded or rejected rather than trusted. Design the check to fail closed.

Each of these needs a test that would have FAILED before the fix, proven by mutation. For C3 that means an actual concurrency test, not a sequential one that cannot expose the race.

Priority:
1. Any AI write path bypassing ProposalGateService — the product's core security property
2. Collision damage where one parallel run silently reverted another
3. Anything blocking boot, migration, or an exit gate
4. Contract violations
5. Tests proven vacuous by mutation — make them bite, then prove it by mutation
6. Remaining Criticals, then Importants

For every fix, add or repair a test that would have FAILED before it, and prove that by mutation: revert your fix, watch the test go red, restore it.

Where a finding is genuinely wrong, say so with evidence rather than skipping it silently. Where a fix is genuinely out of scope for a fix wave — it needs a design decision or a day of work — say that plainly and name what it needs. **Do not leave a Critical silently open.**

Commit in coherent clusters, early and often.

RETURN under 18 lines: per-finding FIXED / PARTIAL / NOT FIXED with one line each, commits, and anything you believe an audit got wrong.`, {
    label: `fix-round-${round}`,
    model: 'opus',
    effort: 'high',
    schema: S({ commits: { type: 'array', items: { type: 'string' } }, stillOpen: { type: 'array', items: { type: 'string' } } }),
  })

  fixRounds.push(f)

  const rv = await agent(`Re-verify fix wave ${round} against the bar. Trust nothing you did not run yourself.

${COMMON}
${SHIPPABLE}

For each finding the wave claimed FIXED, verify it independently. For each claimed test, **mutation-test it**: revert the code, confirm the test fails, restore. A claimed fix whose test passes either way is NOT fixed, whatever the report says — this project has shipped three Criticals behind exactly that.

Then run the bar itself: boot, migrate onto an empty database, both unit suites, every exit gate. Real output.

Write to ${WS}/reverify-${round}.md, and make its first section a plain list of **which Criticals remain open**, so the next wave can act on it directly.

RETURN under 15 lines: per-finding ADDRESSED / NOT ADDRESSED, any new breakage the wave introduced, the six bar items each pass/fail, and the count of Criticals still open.`, {
    label: `reverify-${round}`,
    model: 'opus',
    effort: 'high',
    schema: S({ criticalsOpen: { type: 'number' }, barStatus: { type: 'array', items: { type: 'string' } }, newBreakage: { type: 'array', items: { type: 'string' } } }),
  })

  fixRounds.push(rv)

  if ((rv?.criticalsOpen ?? 99) === 0) {
    log(`Round ${round}: all Criticals closed and independently re-verified.`)
    break
  }

  open = (rv?.criticalsOpen ?? '?') + ' Critical(s) still open — see ' + WS + '/reverify-' + round + '.md'
  log(`Round ${round}: ${open}`)
}

const fix = fixRounds[fixRounds.length - 1]

const _unusedSingleWave = async () => agent(`Fix everything the three audits found. One wave, all findings.

${COMMON}

Read all three, in this order: ${WS}/collision-audit.md, ${WS}/contract-audit.md, ${WS}/execution-proof.md.

Priority:
1. Any AI write path that bypasses ProposalGateService — this is the product's core security property
2. Collision damage where one run silently reverted another
3. Anything preventing boot, migration, or a gate from passing
4. Contract violations
5. Tests proven vacuous by mutation — fix the test so it bites, then confirm by mutation
6. Everything else Critical or Important

Where you disagree with a finding, say so with evidence rather than skipping it silently. Where a fix is genuinely out of scope, say what it needs.

Commit in coherent clusters, early and often. For every fix, add or repair a test that would have FAILED before it, and prove that by mutation.

RETURN under 18 lines: per-finding FIXED / PARTIAL / NOT FIXED, commits, and anything you believe an audit got wrong.`, {
  label: 'fix-wave',
  model: 'opus',
  effort: 'high',
  schema: S({ commits: { type: 'array', items: { type: 'string' } } }),
})

// ── Verify the fixes, then call it.
phase('Verdict')

const verdict = await agent(`Verify the fix wave and deliver the final verdict on this product.

${COMMON}

Scoped re-review: for each finding in the three audits, verdict ADDRESSED or NOT ADDRESSED against the fix wave's diff. Flag any new breakage the fix wave itself introduced. Do not re-review untouched code.

Then re-run the decisive checks yourself — boot, the exit gates, and three of the eight mutation samples. Trust nothing you did not run.

Then write ${DOCS}/../LAUNCH-READINESS.md (replacing the earlier draft) as an honest assessment for the owner:

- **What works**, each claim with the evidence that proves it
- **What is built but unverified**, and why
- **What is missing**, and what that costs a user
- **Known defects still open**, ranked by what they would do to a real customer
- **The three decisions still with the owner**: the per-account privacy toggle for ingested content reaching a third-party LLM, whether to create a push remote (AGPL makes a public repo a distribution event with source-availability obligations), and deleting the three reference repos
- **A plain go / no-go for a first design-partner trial**, with reasoning

Write it for someone deciding whether to put this in front of a paying customer. No marketing, no hedging. A no-go with a clear path is more useful than a yes that fails in week one.

**Finally, write \`d:/Files/Vatsa/Projects/AI-CRM/QUICKSTART-TESTING.md\`** — the owner is adding their own API keys tomorrow and testing by hand. Give them a path that works on the first try:

- Exactly which env vars must be set before anything works, and which are optional. **Be explicit that with no LLM key the AI layer is inert** — not degraded, inert: no evidence recorded, no proposals generated.
- The start sequence: database init, instance commands, server, worker. Note that the worker is not optional — without it the CRM looks fine while every background job silently never runs.
- **A numbered walkthrough of the product's actual differentiator**, each step with what they should see: sign in → ask the agent to research and update a record → the write is intercepted rather than applied → the proposal appears in the approval inbox with its evidence citation → approve part of it → the record reflects exactly the approved subset → the audit names both the agent and the approver.
- What "working" looks like at each step, and what the most likely failure is with the one command that diagnoses it.
- A short list of things that are known not to work yet, so they do not waste time debugging a gap we already know about.

Verify this walkthrough yourself before writing it down. Do not hand over steps you have not personally executed — the whole point is that their first hour tomorrow is spent testing the product, not discovering our setup bugs.

RETURN under 20 lines: per-finding verdicts, new breakage, boot and gate status, the go/no-go with its single main reason, and the top three things standing between here and production.`, {
  label: 'final-verdict',
  model: 'opus',
  effort: 'high',
  schema: S({ addressed: { type: 'string' }, newBreakage: { type: 'array', items: { type: 'string' } }, goNoGo: { type: 'string' }, topThree: { type: 'array', items: { type: 'string' } } }),
})

return { collision, contracts, execution, fix, verdict }
