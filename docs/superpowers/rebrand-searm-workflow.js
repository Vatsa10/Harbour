export const meta = {
  name: 'rebrand-searm',
  description: 'Rename the fork from SeaRM to SeaRM end to end, on an isolated branch, with a restore point and verification between every wave',
  whenToUse: 'After all five phases are built, reviewed, and their fix waves merged',
  phases: [
    { title: 'Survey', detail: 'Opus produces the exact rename map and the do-not-touch list', model: 'opus' },
    { title: 'Core packages', detail: 'shared, ui, emails, then server, then front' },
    { title: 'Tooling', detail: 'sdk, cli, client-sdk, app scripts, docker, CI' },
    { title: 'Surface', detail: 'user-visible strings, docs, README, assets' },
    { title: 'Verify', detail: 'Opus: full build, tests, boot, and a license/attribution audit', model: 'opus' },
  ],
}

const REPO = 'd:/Files/Vatsa/Projects/AI-CRM/searm'
const WS = `${REPO}/.superpowers/sdd/rebrand-searm`

// Anything in this list is persisted in a database, referenced by a stable
// identifier, or legally required. Renaming it corrupts existing workspaces or
// breaks the licence. This block is repeated to every agent verbatim.
const DO_NOT_TOUCH = `
## NEVER RENAME — these are persisted, identity-bearing, or legally required

Breaking any of these corrupts live workspaces or violates the licence. There is no "probably fine" here.

1. **Universal identifier UUIDs.** Every value in \`searm-shared/src/metadata/constants/*\` is a stable key written into workspace metadata rows. A changed UUID orphans real data. Do not touch a single one.
2. **Postgres schema names** — \`core\`, \`metadata\`, and every per-workspace schema. They exist in the running database.
3. **Database table and column names.** \`proposal\`, \`proposalItem\`, \`evidence\`, \`fact\`, \`agentTask\`, \`agentRun\`, and every SeaRM table. The entities map to real tables.
4. **Shipped instance commands and their class names.** \`INSTANCE_COMMANDS\` entries are matched against rows in the migrations table. Renaming one makes it re-run or silently skip.
5. **GraphQL type and field names** — \`Person\`, \`Company\`, \`Opportunity\`, and all our additions. Clients and stored views depend on them.
6. **Enum string values** persisted in columns: \`ProposalStatus\`, \`ProposalItemStatus\`, \`ProposalActionType\`, \`FieldActorSource\`, and every SELECT field option value.
7. **The standard application identity.** \`searm-standard-application\` and \`SEARM_STANDARD_ALL_METADATA_NAME\` — VERIFY whether the application is keyed by this name in the database before touching it. If it is persisted, it stays, however much it looks like branding.
8. **LICENSE and copyright notices.** This is AGPL-3.0 code. SeaRM's copyright headers and the LICENSE file stay exactly as they are. You may ADD SeaRM attribution alongside; you may never remove or alter SeaRM's. Removing them is a licence violation, not a style choice.

If you are unsure whether something is persisted, assume it is and report it rather than renaming it.
`

const COMMON = `
Repo: ${REPO}. You are on branch \`rebrand/searm\`, cut from \`ai-native-crm\`. Do NOT push. Do NOT work on \`ai-native-crm\` — that branch is the safety net and must stay untouched.

Product name: **SeaRM**. Package scope: \`searm\`. CLI binary: \`searm\`.

${DO_NOT_TOUCH}

## VERIFIED LANDMINES — from the survey pass, each one repo-wrecking

**L1 — token-prefix collisions. Rename the LONGER token first, always.**
\`searm-cli\` is a strict prefix of \`searm-client-sdk\`: a naive match counts 1201 hits where only 14 are real. \`searm-front\` is a prefix of \`searm-front-component-renderer\`: 780 vs 731. Rename in the wrong order and **1,229 references corrupt silently**. Match on exact boundaries and rename \`searm-client-sdk\` before \`searm-cli\`, \`searm-front-component-renderer\` before \`searm-front\`.

**L4 — the app packages pin REGISTRY versions, not \`workspace:*\`.**
The 19 packages under \`packages/searm-apps\` depend on \`searm-sdk\` / \`searm-client-sdk\` at published versions (2.13.0 … 2.27.0, "latest") with their own \`yarn.lock\`, plus \`.yarnrc.yml\` enforcing \`npmMinimalAgeGate: 3d\` and an \`npmPreapprovedPackages\` allowlist. **Renaming those two packages before \`searm-sdk\` exists on the registry makes every app un-installable and reds 6 CI workflows.** Either keep the SDK package names until they are published under the new scope, or convert the apps to \`workspace:*\` first. Decide this explicitly and record it; do not discover it mid-wave.

**L2/L5 — live third-party coordinates that must NOT be rewritten.**
\`searm.com\` (2330 hits), \`Vatsa10\` (1745, including the upstream git remote and every GitHub Actions \`uses:\` reference), \`searmcrm/*\` Docker Hub images (305), \`LICENSE\` line 7 and 735, and 312 \`@license Enterprise\` markers. Also frozen on-disk identities: \`.searm/output\`, \`~/.searm\`, and the env names \`SEARM_API_KEY\`, \`SEARM_API_URL\`, \`SEARM_APP_ACCESS_TOKEN\`, \`SEARM_FUNCTIONS_URL\`. These name another project or a persisted location — renaming them breaks CI, pulls, or existing installs.

**Standard application — resolved.** The lookup is by UUID, not by any string containing "searm": \`application.service.ts:394-397\` → \`SEARM_STANDARD_APPLICATION.universalIdentifier\` → \`'20202020-64aa-4b6f-b003-9c74b97cee20'\`, and an instance command embeds that UUID in raw SQL. Frozen: the UUID, the persisted name value \`'Standard'\`, and the 18 values of \`SEARM_STANDARD_ALL_METADATA_NAME\`. The directory and \`SEARM_STANDARD_*\` symbols are source-only — leave them anyway, since renaming gains nothing and risks the constants they wrap.

**i18n** — change the \`msgid\` at the source call site and let \`lingui extract\` regenerate. Do NOT hand-patch \`msgstr\` values across the 14 locale \`.po\` files (66 files, 1685 occurrences); let them fall back to untranslated and flow through the existing i18n-push/i18n-pull pipeline to real translators.

## What DOES get renamed

Directory names \`packages/searm-*\` → \`packages/searm-*\`; package.json \`name\` fields; the \`@searm\` npm scope; tsconfig path aliases; Nx project names and project.json; import specifiers (\`searm-shared/...\` → \`searm-shared/...\`); jest/vite/storybook config references; Docker image names and compose service names; Helm and k8s manifests; CI workflow references; the CLI binary name and every script that invokes it; README, docs, and all user-visible product strings.

## Method — non-negotiable

Rename with \`git mv\` so history follows the file. Update every reference in the same commit as the move — never leave the tree in a state where an import points at a directory that no longer exists.

**After every wave, run the verification below and paste the real output into your report.** If it is red, fix it before committing; do not hand a broken tree to the next wave. Each wave depends on the previous one having actually worked.

\`\`\`
cd packages/searm-server && npx tsgo -p tsconfig.json --noEmit
cd packages/searm-server && npx jest <a suite you did not touch>
\`\`\`

Nx targets are broken on this Windows box — bypass them. Dev DB: PG 5433 / Redis 6380. \`:5432\` is an unrelated native Postgres.

A grep-and-replace across the repo is NOT acceptable on its own. \`searm\` appears inside words, inside UUIDs, inside URLs to searm.com, and inside the do-not-touch list above. Match on precise boundaries and review every hunk.

Paste real command output for every claim. Agents on this project have reported PASS on a red typecheck.

Report to ${WS}/wave-N-report.md. RETURN under 12 lines: status, commit SHAs, what you renamed, what you deliberately did not, verification output summary, concerns.
`

phase('Survey')
log('SeaRM rebrand: survey first, then rename in dependency order, verifying between waves.')

const survey = await agent(`Produce the complete rename map for turning this SeaRM fork into **SeaRM**, before anything is edited.

${COMMON}

Your job is analysis, not renaming. Do not modify any source file.

Produce \`${WS}/rename-map.md\` containing:

1. **Every package**: current directory, current package.json name, target directory, target name. Include every entry under \`packages/\`.
2. **Dependency order.** Which package must be renamed before which, based on who imports whom. \`searm-shared\` is imported by nearly everything, so it likely goes first and everything else follows — verify rather than assume.
3. **Every reference site class**, with a representative count from a real grep: tsconfig path aliases, nx project names, project.json, import specifiers, jest configs, vite configs, docker files, helm/k8s, CI workflows, package.json scripts, and the app packages under \`packages/searm-apps\` that invoke the CLI.
4. **The CLI binary.** Where \`searm\` is registered as a bin, and every script anywhere in the repo that calls \`npx searm ...\` — including inside \`packages/searm-apps/public/customer-support\`.
5. **A verified do-not-touch inventory.** For each of the 8 categories above, confirm by reading code whether it is genuinely persisted. Item 7 in particular — the standard application identity — must be settled by reading how the application is looked up, not by guessing. Report the answer with the file and line that proves it.
6. **Landmines.** Every place the literal string \`searm\` appears where renaming would be WRONG: URLs to searm.com, the LICENSE, copyright headers, UUID fragments, words containing "searm", upstream remote references, and any user data.
7. **A wave plan** — an ordered list of 4-6 waves, each independently verifiable, with the exact verification command for each.

Be exhaustive. Every later agent works from this document, and anything you miss becomes a broken import discovered three waves later.

RETURN under 15 lines: the map path, package count, the dependency order in one line, the answer to the standard-application question, and the three biggest landmines.`, {
  label: 'survey',
  model: 'opus',
  effort: 'high',
  schema: {
    type: 'object',
    properties: {
      mapPath: { type: 'string' },
      packageCount: { type: 'number' },
      order: { type: 'string' },
      standardApplicationVerdict: { type: 'string' },
      landmines: { type: 'array', items: { type: 'string' } },
    },
    required: ['mapPath', 'order', 'standardApplicationVerdict'],
  },
})

const MAP = `Work from the rename map at ${WS}/rename-map.md. It is authoritative — it was produced by reading this codebase, and it records which things are persisted and must NOT be renamed.`

// Strictly sequential. Every wave leaves the tree compiling for the next one.
phase('Core packages')

const w1 = await agent(`Wave 1 of the SeaRM rebrand: the leaf packages that everything else imports — shared, ui, emails.

${MAP}
${COMMON}
CONTROLLER NOTE: these are imported by nearly every file in the repo, so this wave touches the most import statements and sets the pattern for the rest. Get the tsconfig path aliases right first, then the imports follow mechanically. Do not start the server package; that is Wave 2.`, {
  label: 'wave-1-shared',
  model: 'sonnet',
  schema: { type: 'object', properties: { status: { type: 'string' }, commits: { type: 'array', items: { type: 'string' } }, verification: { type: 'string' }, concerns: { type: 'string' } }, required: ['status', 'verification'] },
})

const w2 = await agent(`Wave 2 of the SeaRM rebrand: the server package.

${MAP}
${COMMON}
CONTROLLER NOTE: this is the largest package and it carries the do-not-touch material — entities, instance commands, enum values, schema names. Rename the package and its references; leave every persisted identifier exactly as it is. Wave 1 is committed; build on it.`, {
  label: 'wave-2-server',
  model: 'sonnet',
  schema: { type: 'object', properties: { status: { type: 'string' }, commits: { type: 'array', items: { type: 'string' } }, verification: { type: 'string' }, concerns: { type: 'string' } }, required: ['status', 'verification'] },
})

const w3 = await agent(`Wave 3 of the SeaRM rebrand: the front package.

${MAP}
${COMMON}
CONTROLLER NOTE: includes generated GraphQL type directories and vite/storybook config. Verify with \`npx tsgo\` in the front package and by running a front jest suite you did not touch.`, {
  label: 'wave-3-front',
  model: 'sonnet',
  schema: { type: 'object', properties: { status: { type: 'string' }, commits: { type: 'array', items: { type: 'string' } }, verification: { type: 'string' }, concerns: { type: 'string' } }, required: ['status', 'verification'] },
})

phase('Tooling')

const w4 = await agent(`Wave 4 of the SeaRM rebrand: SDK, CLI, client SDK, the app packages, Docker, Helm, k8s and CI.

${MAP}
${COMMON}
CONTROLLER NOTE: the CLI binary becomes \`searm\`. Our own app at \`packages/searm-apps/public/customer-support\` invokes it in its scripts and pins the SDK by name — update both, and confirm the app still builds afterwards. Remember that \`searm dev:build\` prints "Build succeeded" even when a unit fails to compile, so check the built manifest rather than trusting the exit message.`, {
  label: 'wave-4-tooling',
  model: 'sonnet',
  schema: { type: 'object', properties: { status: { type: 'string' }, commits: { type: 'array', items: { type: 'string' } }, verification: { type: 'string' }, concerns: { type: 'string' } }, required: ['status', 'verification'] },
})

phase('Surface')

const w5 = await agent(`Wave 5 of the SeaRM rebrand: everything a human sees.

${MAP}
${COMMON}
CONTROLLER NOTE: product strings in the UI, page and browser titles, email templates, favicon and logo assets, README, docs, and package descriptions. This is where SeaRM actually becomes the product's name rather than a directory prefix.

Two hard limits: do NOT alter the LICENSE or any copyright header, and do NOT rewrite links to searm.com that point at genuine upstream SeaRM documentation — those are references to another project, not our branding.`, {
  label: 'wave-5-surface',
  model: 'sonnet',
  schema: { type: 'object', properties: { status: { type: 'string' }, commits: { type: 'array', items: { type: 'string' } }, verification: { type: 'string' }, concerns: { type: 'string' } }, required: ['status', 'verification'] },
})

phase('Verify')

const verify = await agent(`Final verification of the SeaRM rebrand on branch \`rebrand/searm\` in ${REPO}.

Everything below must be demonstrated by running it, not by reading code. The whole point of this pass is to prove the rename did not quietly break the product.

1. **Nothing persisted was renamed.** Diff \`rebrand/searm\` against \`ai-native-crm\` and check every hunk touching: universal identifier UUIDs, Postgres schema names, table and column names, instance command class names and their INSTANCE_COMMANDS registration, GraphQL type and field names, and persisted enum string values. Any change to these is CRITICAL — report it and say exactly what breaks.
2. **It builds and the tests pass.** Both typechecks, the full server and front jest suites, and the integration suite against the live database (PG 5433). Report real numbers, and compare them against the counts on \`ai-native-crm\` — a suite that vanished is as bad as one that failed.
3. **The server boots.** Start it and confirm the DI graph resolves.
4. **Migrations still work.** Run the instance commands against a fresh database and confirm the six trust-layer tables appear: proposal, proposalItem, evidence, fact, agentTask, agentRun.
5. **The app still installs.** The customer-support app must build and install after the CLI rename.
6. **Licence audit.** LICENSE unchanged, every SeaRM copyright header intact, SeaRM attribution added rather than substituted. State plainly whether the fork still complies with AGPL-3.0.
7. **No dangling references.** Grep for surviving \`searm-\` package references, \`@searm\` scope imports, and \`npx searm\` invocations. Distinguish genuine leftovers from legitimate references to upstream SeaRM.

Write the full report to ${WS}/rebrand-verification.md.

RETURN under 15 lines: verdict SAFE_TO_MERGE | CHANGES_REQUESTED, whether anything persisted was altered, test counts before and after, whether the server boots, whether migrations produce the six tables, the licence verdict, and one line per Critical.`, {
  label: 'verify',
  model: 'opus',
  effort: 'high',
  schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string' },
      persistedAltered: { type: 'string' },
      testsBeforeAfter: { type: 'string' },
      serverBoots: { type: 'string' },
      migrationsOk: { type: 'string' },
      licenceVerdict: { type: 'string' },
      criticals: { type: 'array', items: { type: 'string' } },
    },
    required: ['verdict', 'persistedAltered', 'licenceVerdict'],
  },
})

return { survey, waves: [w1, w2, w3, w4, w5].map((w) => ({ status: w?.status, concerns: w?.concerns })), verify }
