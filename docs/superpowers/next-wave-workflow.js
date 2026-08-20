export const meta = {
  name: 'searm-next-wave',
  description: 'The remaining narrative gaps that the ship gate owns — fires only after the gate releases those files',
  whenToUse: 'AFTER the ship gate completes. These files are gate-owned until then.',
  phases: [
    { title: 'Approval outcomes', detail: 'Tasks, owner assignment, opportunity advance, brief refresh' },
    { title: 'Audit and surfaces', detail: 'Principal contract, dashboard conversion, reply supersession' },
  ],
}

const REPO = 'd:/Files/Vatsa/Projects/AI-CRM/twenty'
const AUDIT = `${REPO}/.superpowers/sdd/final/contract-audit.md`
const WS = `${REPO}/.superpowers/sdd/gaps`

const RULES = `
Repo: ${REPO}. Branch: ai-native-crm. Never push.
Read .claude/skills/ai-trust-layer, twenty-server-patterns, twenty-front-patterns, twenty-verification first.

**Never \`git add -A\`** — stage explicit paths only. A \`git add -A\` snapshot on this branch silently reverted a correct implementation and it took nine hours to notice. Commit within minutes, never batch.

MEMORY: 16GB machine, OOM-killed repeatedly. Never bare \`npx jest\` (23 workers by default). Use:
  cd packages/twenty-server && bash ../../scripts/lowmem.sh test|itest|types|full [pattern]
Postgres 5433 / Redis 6380. \`:5432\` is an unrelated native Postgres.

Paste the real command and its real output for every claim. Never weaken a test to go green. Verify by mutation. Nx is broken; eslint has no resolvable config — say so rather than claiming lint passed.

Report to ${WS}/<label>-report.md. RETURN under 12 lines.
`

const S = { type: 'object', properties: { status: { type: 'string' }, commits: { type: 'array', items: { type: 'string' } }, verification: { type: 'string' }, concerns: { type: 'string' } }, required: ['status'] }
const W = (label, model, body) => agent(`${body}\n${RULES}`, { label, model, schema: S })

phase('Approval outcomes')

const outcomes = await parallel([
  () => W('approval-actions', 'sonnet', `Approving a proposal currently updates record fields and nothing else. The charter promises more.

Audit ${AUDIT}, Lead step 7: "Approved changes update records, **create tasks, assign an owner, and open or advance an opportunity**" — PARTIAL, because no \`ProposalActionType\` exists for any of them. Inbox step 4 has the same gap.

Add the action types and their execution paths, following exactly how CREATE_RECORD/UPDATE_RECORD already work in \`proposal-execution.service.ts\`: same approver auth context, same permission enforcement, same per-item status, same audit. These are new item kinds, not a new write path — nothing may bypass the gate or the approver's role.

Add a test per new action type proving it applies as the approver and respects field permissions.`),

  () => W('principal-audit', 'sonnet', `Close the Principal contract violation.

Audit ${AUDIT}, Contract 5: an approved change writes a record audit entry saying \`MANUAL\` with \`context: {}\`. The charter requires audit entries to distinguish authenticated user, represented user, workflow, agent and integration — and the product's whole claim is "the agent proposes, a human approves, the audit trail names both". Right now it names neither.

\`FieldActorSource\` already carries MANUAL/WORKFLOW/AGENT/API/IMPORT/SYSTEM/WEBHOOK/APPLICATION. Carry the originating agent and the approving user through to the record write so the audit says what actually happened. Test that an approved AI proposal produces an audit entry naming both.`),
])

phase('Audit and surfaces')

const surfaces = await parallel([
  () => W('dashboard-conversion', 'sonnet', `Finish the AI trust dashboard.

Audit ${AUDIT}, Lead step 8: \`ai-trust-dashboard/\` covers source, freshness, conflicts, item outcomes and spend — but **no conversion**, and it is a settings page rather than a dashboard widget.

Add the conversion metric (proposals approved vs rejected vs expired, and what share of approved changes stuck rather than being superseded), and surface it where a user actually looks. Read \`Fact\` only through \`FactService\` — that boundary is deliberate and keeps a later promotion of Fact to a standard object a one-module change.`),

  () => W('reply-supersession', 'haiku', `Make a reply supersede stale work.

Audit ${AUDIT}, Pipeline step 5: \`proposal-supersession.service.ts:207,213\` handles \`FACT_SUPERSEDED\` and \`RECORD_CHANGED\`. **A reply is not a supersession input.** The charter says "replies or stage changes supersede stale work".

Add the reply signal: when a message arrives on a thread a pending outbound-communication proposal was drafted for, that proposal is stale and must be marked SUPERSEDED rather than sitting until TTL. Keep superseded proposals queryable, never deleted. Small change — follow the two existing reasons exactly.`),
])

return { outcomes: outcomes.filter(Boolean), surfaces: surfaces.filter(Boolean) }
