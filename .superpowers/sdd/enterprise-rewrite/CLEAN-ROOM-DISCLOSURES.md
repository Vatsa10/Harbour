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
