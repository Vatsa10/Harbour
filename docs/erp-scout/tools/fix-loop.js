export const meta = {
  name: 'erp-fix-loop',
  description: 'Iterate until the ERP build installs, typechecks and passes its tests, then report honestly',
  phases: [{ title: 'Diagnose' }, { title: 'Fix' }, { title: 'Report' }],
}

const ROOT = 'd:/Files/Vatsa/Projects/AI-CRM'
const ERP = ROOT + '/erp'
const D = ROOT + '/docs/erp-scout'

const DIAG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['installOk', 'typecheckOk', 'testsOk', 'migrationsOk', 'summary', 'packages', 'blockers'],
  properties: {
    installOk: { type: 'boolean' },
    typecheckOk: { type: 'boolean' },
    testsOk: { type: 'boolean' },
    migrationsOk: { type: 'boolean' },
    summary: { type: 'string', description: 'what actually happened, blunt' },
    packages: {
      type: 'array',
      description: 'one entry per package with problems, ordered worst first',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pkg', 'errorCount', 'errors', 'kind'],
        properties: {
          pkg: { type: 'string', description: 'workspace path under packages/, e.g. packages/ledger' },
          errorCount: { type: 'number' },
          kind: { type: 'string', enum: ['install', 'typecheck', 'test', 'runtime', 'schema', 'missing'] },
          errors: { type: 'array', items: { type: 'string' }, description: 'verbatim error text, truncated per error but never paraphrased' },
        },
      },
    },
    blockers: { type: 'array', items: { type: 'string' }, description: 'cross-cutting problems no single package can fix alone' },
  },
}

const CTX = `

PROJECT: a commercial ERP for Indian manufacturing SMEs at ${ERP}. Bun + NestJS + PostgreSQL 17 + Drizzle + Next.js.
SPECS: ${D}/ERP-BUILD-PLAN.md (work items, DDL, acceptance criteria) and ${D}/ERP-MVP-PLAN.md (architecture and business rules).

STANDING RULES, same as the build:
- CLEAN-ROOM: never copy from ERPNext/Odoo/Frappe/gauzy/idurar.
- Statutory rates, thresholds and windows are rule-store rows flagged needs_ca_confirmation, NEVER constants.
- Money is never a float.
- Never weaken or delete a test to make it pass. If a test is wrong, fix it and say so explicitly in your report.
- Never stub a function to silence a type error. A deliberate stub carries a TODO naming the spec section that owes it.
`

const MAX_ROUNDS = 6
let round = 0
let last = null

while (round < MAX_ROUNDS) {
  round += 1

  phase('Diagnose')
  const diag = await agent(
    `Diagnose the ERP build at ${ERP}. Round ${round}. Run the real commands and capture the real output.

1. cd ${ERP} && bun install    (report failures verbatim)
2. the typecheck script from the root package.json, or bunx tsc --noEmit -p tsconfig.json
3. bun test
4. Schema: bring up the docker-compose Postgres if it is not already running (its port is in ${ERP}/docker-compose.yml), apply the migrations, and report the result. If Docker will not start, try the local PostgreSQL 17 install instead, and if neither works say so plainly and set migrationsOk false with the reason in blockers.

Group every error by the package that owns it. Use the workspace path (packages/<name>) as pkg. Quote error text verbatim — never paraphrase a compiler error, because the fixer needs the exact symbol names. Cap each error string at ~400 chars but keep the head where the useful part is.

Put anything no single package can fix into blockers: a missing shared type, a schema column three packages disagree about, a circular workspace dependency, a missing root config.

Be blunt. If almost nothing works, say that. Do NOT fix anything in this pass.${CTX}`,
    { label: `diagnose:round-${round}`, phase: 'Diagnose', schema: DIAG_SCHEMA, effort: 'high' }
  )

  last = diag

  if (!diag) {
    log(`round ${round}: diagnosis returned nothing, stopping`)
    break
  }

  log(`round ${round}: install=${diag.installOk} typecheck=${diag.typecheckOk} tests=${diag.testsOk} migrations=${diag.migrationsOk}, ${diag.packages.length} packages with errors, ${diag.blockers.length} blockers`)

  if (diag.installOk && diag.typecheckOk && diag.testsOk && diag.migrationsOk) {
    log(`round ${round}: GREEN`)
    break
  }

  phase('Fix')

  // Blockers first and alone: they are cross-cutting, so fixing them in parallel with
  // package fixes would have two agents editing the same shared file.
  if (diag.blockers.length) {
    await agent(
      `Fix the cross-cutting blockers in the ERP build at ${ERP}. Round ${round}.

Blockers:
${diag.blockers.map((b, i) => `${i + 1}. ${b}`).join('\n')}

Context from this round's diagnosis:
${diag.summary}

These are problems no single package can fix alone: shared types, schema disagreements, workspace wiring, root config. Fix them at their source. Where two packages disagree about a shape, consult ${D}/ERP-BUILD-PLAN.md section 3 (CORE DATA MODEL) and make the schema the authority, then fix the callers.

You may edit any file, because you are the only agent running in this step. Report what you changed and why.${CTX}`,
      { label: `fix:blockers-r${round}`, phase: 'Fix', effort: 'high' }
    )
  }

  const targets = diag.packages.slice(0, 12)
  if (targets.length) {
    await parallel(targets.map(p => () =>
      agent(
        `Fix the errors in ${ERP}/${p.pkg}. Round ${round}.

Error kind: ${p.kind}. Count: ${p.errorCount}.

Verbatim errors:
${p.errors.map((e, i) => `[${i + 1}] ${e}`).join('\n\n')}

Round summary for context (other packages are being fixed concurrently):
${diag.summary}

Fix the cause, not the symptom. If an error is caused by another package's missing or wrong export, do NOT patch around it locally with a cast or a redeclaration: note it in your report so the next round's blocker pass fixes it properly. If your package genuinely needs something the spec never defined, implement the minimal correct version and leave a TODO naming the spec section.

Run your own package's tests before finishing (bun test from inside your package directory) and report what still fails.

You own ${ERP}/${p.pkg} and nothing else. Other agents are editing other packages right now.${CTX}`,
        { label: `fix:${p.pkg.replace('packages/', '')}-r${round}`, phase: 'Fix', effort: 'high' }
      )
    ))
  }
}

phase('Report')
const report = await agent(
  `Write ${D}/ERP-BUILD-STATUS.md using the Write tool — the honest state of the ERP build after ${round} fix round(s).

Final diagnosis from the last round:
${JSON.stringify(last).slice(0, 120000)}

Re-verify before writing: run bun install, the typecheck, and bun test yourself at ${ERP}, and report what YOU observed rather than trusting the diagnosis above. If they disagree, say so and trust your own run.

Required sections:
1. **Status in one line** — does it install, typecheck, test and migrate. No hedging.
2. **What genuinely works** — per package, with the evidence (test names that pass, not assertions of quality).
3. **What is broken** — per package, with the real error text, ordered by what blocks the most.
4. **What is a stub** — modules that compile but do not implement their spec. Grep for TODO and for functions that return empty or throw not-implemented. This is the section that stops a green build from being mistaken for a working product.
5. **Rule compliance** — did any statutory constant get hard-coded (grep near tax, gst, pf, esi, threshold, window, rate), is money ever a float, was any test weakened or deleted to force a pass, does any file look copied from a reference repo.
6. **Distance to the first milestone** — the acceptance suite asserts a GST-valid invoice, an IRN payload, a delivery challan, a GSTR-1 extract and a job-work liability. Which of those five are reachable now, and what specifically is missing for each.
7. **Next three actions** — concrete, ordered, each one a thing someone could start immediately.

Blunt and specific. A status report that overstates progress is worse than no report, because the next decision gets made on it.${CTX}`,
  { label: 'status-report', phase: 'Report', effort: 'high' }
)

return { rounds: round, green: !!(last && last.installOk && last.typecheckOk && last.testsOk && last.migrationsOk), report }
