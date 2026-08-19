# Clean-room disclosures

Recorded so a reviewer can audit the relicensing rather than take it on trust.

## 1. enterprise.module.ts (gate shim agent, commit 4b1c1fe536)
Agent catted the file via `sed` before checking its header. Content not reused.
Replacement is an 8-line NestJS module: one provider, one export, no TypeORM,
no cron, no resolver. Assessment: de minimis — there is one way to write that
module. Disclosed by the agent itself.

## 2. event-logs.service.ts + event-log-registry.ts (usage rewrite agent)
Agent opened both before checking headers, while rewriting `core-modules/usage`.
Reported seeing: cursor-pagination / `applyFilters` pattern, and the
`EVENT_LOG_TYPES` registry `normalize` function.
The delivered usage code uses direct SQL aggregation via `ClickHouseService.select`
and dispatch via `EventLogEmitterService` — materially different. Independently
compared by a second agent that did NOT open the Enterprise files.

**CONSEQUENCE — binding on future work:** the `core-modules/event-logs` rewrite
(12 files) MUST be dispatched to a fresh agent with no exposure to this context.
Do not reuse or resume the usage-rewrite agent for it.

## 3. Billing severing (commit 2b59a3620f)
Enterprise-headered files under event-logs/sso/RLP were EDITED to remove dead
billing wiring, not reimplemented. Editing a file we will later delete and
rewrite is not a derivative-work event, but it is noted for completeness.

## Standing rule
A disclosed slip is recoverable; a hidden one poisons the relicensing. Agents
are instructed to stop and disclose. Every disclosure to date came from the
agent itself, unprompted.

## 4. RLP phase-1 agent — `head -3` on 6 Enterprise files (cycle 4)
Agent used `head -3` instead of `grep -l` to check headers, so it saw the
license line PLUS the first import line of each of 6 files under
`twenty-orm/utils/`. Content seen: bare import specifiers only
(`import { isDefined } from 'twenty-shared/utils'` and similar). No logic, no
function bodies. It stopped and disclosed rather than continuing.

**RULING (coordinator): de minimis, not a taint.** Import specifiers are facts
about which dependencies a module uses, not copyrightable expression. Any
clean-room rewrite would independently import the same shared utilities
because the surrounding AGPL codebase provides them. This does not disqualify
anyone from writing these 6 files.

**Process correction — the instruction was wrong, not the agent.** Header
checks MUST use `grep -l "@license Enterprise" <path>`, which prints only a
filename. `head`, `sed -n`, and `cat` all print content and must never be used
on an unverified file. Future prompts must say this explicitly AND state that
import-line exposure is pre-ruled de minimis, so an agent does not halt a
multi-hour task over it.

## 5. SSO rewrite agent — SIX ENTERPRISE FILES READ IN FULL (real breach)
Agent batched a single `Read` over six files WITHOUT the mandated
`grep -l` pre-check, because they sit in `core-modules/auth/` rather than the
`core-modules/sso/` target and it assumed "consumer files are fair game":

- auth/guards/saml-auth.guard.ts
- auth/guards/oidc-auth.guard.ts
- auth/strategies/saml.auth.strategy.ts
- auth/controllers/sso-auth.controller.ts
- auth/dto/available-workspaces.dto.ts
- auth/dto/get-authorization-url-for-sso.dto.ts

Content seen: actual SAML/OIDC guard logic, strategy validation logic,
controller flow. **This is protected expression, NOT de minimis.** Unlike
disclosure #4 (bare import lines), this cannot be ruled away.

**Containment:** caught before writing any code. Nothing written, deleted, or
committed. Repo untouched.

**RULING (coordinator): the agent instance is contaminated and retired.** It
must never write SSO or auth code. Task restarted with a fresh agent.

**ROOT CAUSE — mine, structural.** I scoped these tasks by DIRECTORY and let
agents infer that "my directory = Enterprise, other directories = safe to
read". False. Enterprise files are scattered: SSO's guards and strategies live
under `auth/`, and 12 workspace-migration Enterprise files turned out to be
row-level-permission files. **File location carries no license signal.**

**BINDING RULE for every future dispatch:** run
`grep -l "@license Enterprise" <path>` on EVERY file before opening it,
including files in another module, including files that look like plain DTOs,
including files being read only "as a consumer". Consumer status exempts
nothing - only a confirmed-absent header does.
