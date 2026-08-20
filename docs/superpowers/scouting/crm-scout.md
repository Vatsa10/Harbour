# Scouting report: `crm` repo (NestJS + Next.js + Prisma + eve)

Source repo: `d:/Files/Vatsa/Projects/AI-CRM/crm`
Scope: extract design worth porting into Twenty. No code is portable — Twenty is
NestJS/TypeORM/GraphQL on its own workspace-schema-per-tenant model, `crm` is
Prisma/single-schema with an `eve`-framework agent runtime (`node_modules/eve`,
a third-party durable-agent-session framework, not written in this repo). Every
section below is a description of the *mechanism*, not code to copy.

Also note: there is **no bespoke durable job-queue engine** here — the actual
task queue (`AgentTask`) is homegrown Postgres-row leasing, described below.
The agent *sessions* themselves (LLM loop, retries of individual tool calls,
conversation persistence) are delegated to the `eve` npm package, which this
repo does not implement and which is irrelevant to port (it's Twenty's
job to build or buy its own session runtime, not reproduce eve).

**Archive status.** This report is the only surviving record of this codebase.
Sections 1–5 cover the BUILD NOW capabilities. **§6 and §7 exist because the
DEFER/CUT rows will not be built before the repo is deleted** — each has been
re-read against source and written out with data model, control flow and
failure semantics, so nothing there needs `crm` reopened. Two former DEFER rows
were reclassified as not worth porting (§7); one (row 26, suppression lists)
was found to have been **mis-scouted** and is corrected in §6.4.

| DEFER row | Status | Full record |
|---|---|---|
| 21 — relevance-scored CRM search | **Reclassified: not worth porting** | §7.1 |
| 22 — per-record `EnrichmentStatus` | Deepened | §6.1 |
| 23 — vendor enrichment pipelines | Deepened | §6.2 |
| 24 — session-continuation bookkeeping | Deepened | §6.3 |
| 25 — email/calendar ingestion | Deepened | §6.4 |
| 26 — suppression lists | Deepened **+ mis-scouting corrected** | §6.4 (final subsection) |
| 27 — `AppSetting` singleton | **Reclassified: not worth porting** | §7.2 |

---

## 1. Durable autonomous research: the task queue

### Data model

`packages/db/prisma/schema.prisma` lines 312–337:

```prisma
model AgentTask {
  id        String  @id @default(cuid())
  contactId String?
  companyId String?

  kind   String
  reason String

  priority Int @default(0)
  budget   Int @default(4)
  attempts Int @default(0)

  dueAt       DateTime
  leasedUntil DateTime?

  sessionId  String?
  startedAt  DateTime?
  finishedAt DateTime?
  outcome    String?

  createdAt DateTime @default(now())

  @@index([dueAt, leasedUntil])
  @@index([contactId])
  @@map("agentTask")
}
```

Companion tables (not a queue, but the audit trail hung off a task run):

```prisma
model AgentEvent {
  id        String  @id
  sessionId String
  contactId String?
  type      String
  data      Json
  emittedAt DateTime
  @@index([sessionId, emittedAt])
  @@index([contactId, emittedAt])
}

model AgentConversation {
  id        String  @id @default(cuid())
  contactId String?
  companyId String?
  dealId    String?
  ...
}
```

`kind` is a plain string but constrained in application code
(`packages/db/src/agent-tasks.ts`):

```ts
export const TASK_KINDS = [
  "brand", "portrait", "meeting-prep", "identify",
  "profile", "recheck", "company-profile", "workspace-profile",
] as const;

export const DIRECT_KINDS = ["brand", "portrait"] as const; // no LLM session needed

export const PRIORITY = {
  brand: 900, portrait: 800, workspace: 500, requested: 300,
  meeting: 200, identify: 100, sweep: 50, companyProfile: 40, recheck: 0,
} as const;
```

### Control flow — leasing (`apps/agent/agent/lib/tasks.ts`)

One SQL statement does claim + lease + attempt-increment atomically, using
`FOR UPDATE SKIP LOCKED` so multiple workers/pods never double-claim a row:

```sql
UPDATE "agentTask" AS t
SET "leasedUntil" = :until,
    "startedAt" = COALESCE(t."startedAt", :now),
    "attempts" = t."attempts" + 1
FROM (
  SELECT t2.id FROM "agentTask" AS t2
  WHERE t2."finishedAt" IS NULL
    AND t2."dueAt" <= :now
    AND (t2."leasedUntil" IS NULL OR t2."leasedUntil" < :now)
    AND t2."attempts" < 3
    AND t2.kind IN/NOT IN (...)
  ORDER BY t2."priority" DESC, t2."dueAt" ASC
  LIMIT :limit
  FOR UPDATE SKIP LOCKED
) AS due
WHERE t.id = due.id
RETURNING t.id, ...;
```

Design decisions worth keeping:

- **Lease, don't lock.** A task is "in flight" only while `leasedUntil` is in
  the future; a crashed worker's task simply becomes claimable again once the
  lease expires. No heartbeat process, no separate "worker died" detector — the
  lease timeout **is** the failure detector.
- **`FOR UPDATE SKIP LOCKED`** inside a `SELECT` subquery feeding an `UPDATE ...
  FROM` is what makes concurrent claims safe under horizontal scale-out with a
  single SQL round trip and no application-level distributed lock.
- **Two lease durations for two lanes** — a "direct" lane (`brand`, `portrait`:
  cheap, deterministic, no LLM session, 2 min lease, batch 60, concurrency 6)
  and a "research" lane (needs a full agent session, 30 min lease, batch 12).
  This is a clean split between "no LLM needed, hammer it" work and "an agent
  session that might genuinely take a while" work, scheduled by two different
  drain loops (`runVisibleLane` / `runResearchLane` in `dispatch.ts`).
- **Attempts is bounded (`MAX_ATTEMPTS = 3`)**, and a separate sweep
  (`retireExhausted`) finalizes tasks that hit the cap and are not leased,
  writing a human-readable `outcome` ("Gave up after 3 attempts: the session
  never reported back.") rather than leaving them silently stuck. This is
  the retry-exhaustion path, distinct from the claim path — cheap to reason
  about because it's two separate, small SQL statements instead of one
  do-everything state machine.
- **Idempotent scheduling.** `scheduleTask()` looks for an existing *unfinished*
  task of the same `(kind, contactId, companyId)` before inserting; if found it
  just bumps `dueAt`/`reason` instead of creating a duplicate. This is the
  dedup mechanism that keeps "recheck in 30 days" schedule calls from piling up
  duplicate rows.
- **Completion is a guarded update, not a delete.** `completeTask()` does
  `updateMany({ where: { id, finishedAt: null }, data: { finishedAt, outcome }})`
  — the `finishedAt: null` guard makes it safe to call from a stale/duplicate
  session without double-completing or overwriting a result that another
  attempt already wrote.
- **Priority is a plain integer set at schedule time**, not computed
  dynamically — simple, and the priority table above is the entire "scheduling
  policy," legible at a glance.

### Cancellation

There is no explicit cancel endpoint/flag in the schema — a task is
"cancelled" only implicitly: nothing marks it `finishedAt` early except the
executor completing it or the exhaustion sweep giving up. **This is a gap**,
not a design decision to copy: if a contact is deleted mid-research there is
no visible mechanism revoking its outstanding `AgentTask` rows (they'd just
fail to find the contact and self-complete via the `runDirect` fallback
`"The record this names is gone."` for the direct lane only — the research
lane has no equivalent guard visible in what was read). Worth doing better
in Twenty: an explicit `cancelledAt` / status enum rather than relying on
downstream 404s.

### What's genuinely worth porting

- The **lease-based claim query** (single `UPDATE...FROM...SELECT...FOR UPDATE
  SKIP LOCKED...RETURNING`) as the pattern for any durable job table Twenty
  builds — it's DB-native, horizontally safe, and needs no external queue
  broker.
- The **two-lane split** by whether work needs an LLM session or not.
- **Idempotent upsert-scheduling** keyed on `(kind, subjectId)` to avoid
  duplicate pending work.
- **Attempts-capped-then-explicit-finalization-sweep** as two small
  operations instead of one large state machine.

### What NOT to port

- `budget: Int` on the task row is *set* (default 4) but, as far as the code
  read shows, is only ever passed through as a session attribute
  (`taskAuth()` in `dispatch.ts`) and consumed **per-session** via an
  in-memory `defineState` counter (see §4) — it is never decremented,
  reconciled, or read back onto the `AgentTask` row itself. It's really a
  per-session spend cap, not a durable budget ledger. Don't port the DB column
  literally; port the concept as "spend cap passed into the session," and if
  Twenty wants durable accounting, track actual spend server-side (see §4's
  "what NOT to port").
- The `eve` framework itself (session runtime, `defineDynamic`, `defineState`)
  is a third-party product this repo depends on, not something built here —
  irrelevant to scout.

---

## 2. Evidence-backed facts

### Data model

```prisma
enum FactBand   { VERIFIED PROBABLE POSSIBLE }
enum FactStatus { APPLIED PROPOSED DISMISSED SUPERSEDED }

model ContactFact {
  id        String  @id @default(cuid())
  contactId String
  field     String
  value     String

  score Float
  band  FactBand

  evidence Json        // Evidence[] — see below

  method    String
  sourceUrl String?
  sessionId String?

  status      FactStatus @default(PROPOSED)
  decidedById String?
  decidedAt   DateTime?

  observedAt   DateTime  @default(now())
  supersededAt DateTime?

  @@index([contactId, field, status])
  @@index([status, observedAt])
}

model ContactBrief {
  contactId String  @id
  narrative String
  sections  Json
  score     Float
  sourceUrl String?
  sessionId String?
  refreshedAt DateTime @default(now())
}
```

`field` is one of a fixed set (`apps/agent/agent/lib/facts.ts`):
`name, title, linkedinUrl, twitterUrl, githubUrl, employer, seniority,
function, location, tenure` — each optionally mapped to a real `Contact`
column (`title`, `linkedinUrl`, etc.) or `null` for fields with no dedicated
column (`name`, `employer`, `seniority`, `function`, `location`, `tenure`
live only as facts/brief text, not as columns — deliberately: derived,
low-confidence attributes don't get a schema column of their own).

### The evidence → score → band pipeline (`apps/agent/agent/lib/evidence.ts`)

This is the standout mechanism. An "observation" (`Evidence = { kind, detail,
sourceUrl? }`) is never itself a confidence number — the *agent* only reports
what it saw, tagged with one of a fixed enum of **evidence kinds**, each with
a hardcoded weight and a `primary: boolean` flag:

```ts
export const WEIGHTS: Record<EvidenceKind, Weighting> = {
  "profile.email-match":        { weight: 0.95, primary: true,  label: "..." },
  "linkedin.employer-and-name": { weight: 0.85, primary: true,  label: "..." },
  "crm.thread-reply":           { weight: 0.85, primary: true,  label: "..." },
  "crm.signature-block":        { weight: 0.80, primary: true,  label: "..." },
  "github.account-identity":    { weight: 0.80, primary: true,  label: "..." },
  "crm.meeting-attendance":     { weight: 0.70, primary: true,  label: "..." },
  "web.cited-claim":            { weight: 0.40, primary: false, label: "..." },
  "handle.name-form":           { weight: 0.35, primary: false, label: "..." },
  "search.cites-profile":       { weight: 0.35, primary: false, label: "..." },
  "employer-only":              { weight: 0.20, primary: false, label: "..." },
  contradiction:                { weight: 0,    primary: false, label: "..." },
};
```

Multiple independent pieces of evidence are combined with **noisy-OR**
(probabilistic "at least one of these is right"), not summed:

```ts
const combined = evidence.reduce((remaining, item) =>
  remaining * (1 - WEIGHTS[item.kind].weight), 1);
let score = Math.min(0.99 /* CEILING */, 1 - combined);
if (contradicted) score = Math.min(score, 0.45 /* CONTRADICTED */);
```

Then a fact only "counts" if it clears a band floor **and**, for the top
band, has at least one primary (identity-establishing) source:

```ts
export const BAND_FLOOR = { VERIFIED: 0.85, PROBABLE: 0.55, POSSIBLE: 0.3 };

function bandFor(score, hasPrimary) {
  if (score >= 0.85 && hasPrimary) return "VERIFIED";
  if (score >= 0.55) return "PROBABLE";
  if (score >= 0.3) return "POSSIBLE";
  return null; // not stored at all
}
```

### Recording / applying / superseding a fact (`recordFact()` in `facts.ts`)

Sequential guard chain before anything is written, in this order:

1. Empty value → reject, not stored.
2. Score below `POSSIBLE` floor → reject, not stored ("Below the floor for
   keeping").
3. **Already dismissed** — if a human previously `DISMISSED` this exact
   `(field, value)` pair, never re-offer it (case-insensitive/trimmed compare
   via `sameValue()`). This is the "don't nag" rule.
4. **Already applied, same value from a fresh source** → no-op, nothing
   changed.
5. **Human ownership check (`humanOwns()`)** — if a person manually filled the
   corresponding `Contact` column (and there's no existing *agent*-sourced
   fact backing it), the agent may never overwrite it. Special case for
   `name`: a name is "human-owned" unless it looks *derived from the email
   address* (`isDerivedName()` — e.g. `"Pmarchetti"` parsed straight out of
   `pmarchetti@fernhill.com`); only a derived placeholder name is eligible to
   be improved by the agent.
6. Only then: if `band === VERIFIED`, apply — in a transaction: mark any prior
   `APPLIED` fact for this `(contact, field)` as `SUPERSEDED` (with
   `supersededAt`), insert the new fact as `APPLIED`, and mirror the value
   onto the real `Contact` column (plus first/last name split for the `name`
   field). If band is `PROBABLE`/`POSSIBLE`, the fact is still inserted — as
   `PROPOSED` — but the `Contact` row is untouched. It becomes a suggestion a
   rep can accept or dismiss in the UI.

Freshness/history is queryable directly off status/timestamps, e.g.
`lastEmployerChange()` diffs the most recent `SUPERSEDED` employer fact
against the current `APPLIED` one to detect and narrate a job change.

### Conflict representation

Conflicts are **not** resolved by the scoring math — they're surfaced. A
`"contradiction"` evidence kind (weight 0) caps the score at `0.45` (below the
`PROBABLE` floor) regardless of how much other corroborating evidence exists,
guaranteeing a contradicted claim is held rather than auto-applied, and the
rationale string explicitly says `"Held: <what the contradiction was>."` This
is a deliberate under-ride: contradiction evidence intentionally cannot be
outweighed by piling on more supporting evidence in the same batch.

### Design decisions worth keeping (strongest section of this repo)

- **Agents report observations, never confidences.** The scoring is entirely
  server-side and deterministic from a fixed, auditable weight table. This
  removes the single biggest reliability failure mode of LLM-driven data
  enrichment (models self-reporting confidence, which is uncalibrated and
  ungameable-to-verify) and makes score computation independently testable
  and explainable to a human via the tooltip-ready `rationale` string.
  **This is the one mechanism most worth reimplementing in Twenty verbatim
  as a concept**, regardless of stack.
- **Noisy-OR combination**, not sum/average — correctly models "any one strong
  independent source is enough," while still letting several weak sources
  add up, without the pathology of naive summation exceeding 1.0.
- **`primary` gate on the top band** — score alone isn't sufficient for the
  fact to auto-apply; you additionally need at least one source that
  *identifies the person*, not just corroborates a detail about them. This
  stops many weak-but-numerous signals from masquerading as one strong one.
- **Fixed enum of evidence kinds** with human-readable labels baked in at
  the type level — the "why" a fact was written is reconstructable from data
  alone, not from a free-text confidence explanation an LLM invented after
  the fact.
- **Three-tier band → three different outcomes**: `VERIFIED` writes to the
  record; `PROBABLE`/`POSSIBLE` become a `PROPOSED` fact (a suggestion UI
  affordance) rather than either being silently dropped or silently applied.
  This turns "not sure" into a first-class, useful state instead of a binary
  accept/reject.
- **Supersession keeps history, not deletion.** `SUPERSEDED` rows are never
  removed, enabling "what changed and when" queries (`lastEmployerChange`)
  for free.
- **Human-write supremacy with a narrow, well-justified exception** (derived
  placeholder names only) — a general rule ("agents never overwrite
  human-entered data") with one explicit, tightly scoped carve-out, rather
  than a blanket "agent can overwrite anything below some score."
- **Dismiss is permanent per exact value** — prevents re-proposing something
  a rep already said no to, without blocking a *different* future value for
  the same field.

### What NOT to port

- The specific weight numbers (0.95, 0.85, ...) and specific evidence kinds
  (`linkedin.employer-and-name`, `crm.thread-reply`, etc.) are tuned to this
  product's exact vendor set (LinkedIn scraping, Gmail/Calendar sync) — port
  the *mechanism* (enum of kinds → weight table → noisy-OR → band floors →
  primary gate), not these literal values.
- `evidence: Json` with no schema enforcement beyond the Zod tool-input
  validation at write time is a reasonable pragmatic choice here (single
  Postgres schema, small team) but Twenty should model evidence as a proper
  related table/JSONB with an explicit versioned shape, since Twenty's
  workspace-schema system already has patterns for this and untyped JSON
  columns are a known long-term maintenance cost.

---

## 3. Identity resolution

There is **no deterministic company/person fuzzy-matching function** in this
repo of the kind you'd expect from a classic dedup engine (no Jaro-Winkler,
no normalized-domain-plus-name scoring function in code). Identity resolution
here is handled almost entirely as **agent procedure + evidence scoring**,
not as a standalone deterministic algorithm. That's a meaningfully different
design from what the audit brief implied ("deterministic matching rules") —
worth flagging explicitly as a finding, not just reporting the absence.

The closest things to deterministic identity rules found:

- **`Contact.email` is `@unique`** and **`Company.domain` is `@unique`** at
  the schema level (`packages/db/prisma/schema.prisma` lines 141, 210) — the
  only hard, DB-enforced identity keys in the whole system. Everything else
  is soft.
- **`isDerivedName()` / `splitName()`** (`apps/agent/agent/lib/names.ts`, not
  fully read but referenced from `facts.ts`) — a deterministic check for
  "does this contact's current name look like it was mechanically derived
  from the email local-part" (e.g. `"Pmarchetti"` from `pmarchetti@...`),
  used only to decide whether the agent is allowed to overwrite the name
  field, not to *match* records to each other.
- **The actual matching procedure** lives entirely in
  `apps/agent/agent/skills/identity-matching.md`, i.e. it's a *prompted
  procedure an LLM agent follows*, not code:
  1. Check CRM history first (free, and `crm.thread-reply` is decisive if
     found).
  2. Decompose the email local-part into candidate name fragments
     (`pmarchetti` → surname `marchetti`), search *that* + company — "the
     guess goes into the query, never into the answer."
  3. Fetch each LinkedIn candidate profile and get a **verdict** with two
     independent boolean checks: `employerMatches` (current position matches
     company on file) and `nameMatches` (name is a plausible expansion of
     the email local-part).
  4. **Both-or-nothing**: one match without the other is treated as a
     different person who happens to share one attribute, not a partial
     match — explicitly called out as the core rule ("One of the two is not
     a weaker match, it is a different person who happens to share
     something").
  5. If nothing passes both checks, **stop** — leaving a placeholder name in
     the CRM is the explicitly-endorsed failure mode over guessing.
  6. The verdict, not raw profile data, is what gets reported to
     `identify_contact`, which converts it into the evidence-kind system from
     §2 (`linkedin.employer-and-name` if both pass, `employer-only` or
     `search.cites-profile` if only one, `contradiction` if two sources
     disagree).

### Design decisions worth keeping

- **"Guess where to look, never what you'll find."** The generative step
  (LLM guessing a name from an email) is confined to *query construction*;
  the *answer* always has to come from an external, checkable source (a
  fetched profile). This is a strong, reusable principle for any AI-assisted
  matching workflow, independent of stack.
- **Two-factor, both-required verdict** (employer + name), not a single
  fuzzy score — deliberately avoids the "half a match" pathology where an
  identity resolution system slowly accumulates false-positive merges from
  partial signals. Directly maps onto Twenty's duplicate-detection UX as "a
  match needs an independent employer signal AND an independent name signal,
  not a similarity score."
- **A failed match becomes a low-value evidence entry offered to a human**
  (`employer-only`, `search.cites-profile`), rather than silently discarded
  or silently applied — same "suggestion, not silence" principle as §2's
  `PROPOSED` fact status, reused consistently.

### What NOT to port

- There is no deterministic company-name/person-name similarity algorithm to
  extract — don't assume one exists to copy. If Twenty needs classic
  deterministic dedup (e.g. exact-domain-match, normalized-name +
  fuzzy-threshold merge suggestions), that has to be designed fresh; this
  repo's approach is fully LLM-procedure-driven and depends on paid vendor
  lookups (LinkedIn), which is not something to depend on for Twenty's
  baseline dedup story.
- The literal LinkedIn-scraping tool set (`resolve_linkedin_profile`,
  `get_linkedin_profile`) is vendor/product-specific plumbing, not a
  reusable design.

---

## 4. Research budgets and cost accounting

This is thin and in-memory, not durable — worth flagging as a place Twenty
should improve on rather than copy directly.

`apps/agent/agent/lib/focus.ts`:

```ts
export const focus = defineState("crm.focus", () => ({
  contactId: null, companyId: null, sessionId: null,
  spent: 0,
  budget: 4,
}));

export function spend(units = 1) {
  const { spent, budget } = focus.get();
  if (spent + units > budget) {
    return { ok: false, reason:
      `Research budget for this contact is spent (${spent}/${budget}). ` +
      "Write up what you already have, or schedule a recheck with a reason. Do not keep looking." };
  }
  focus.update(current => ({ ...current, spent: current.spent + units }));
  return { ok: true };
}

export function setBudget(budget: number): void {
  focus.update(current => ({ ...current, budget }));
}
```

- `budget` is a plain integer "number of vendor calls," set per session from
  the `AgentTask.budget` column (default 4) via
  `apps/agent/agent/instructions/task.ts`'s `session.started` handler.
- Only "vendor calls" (paid external lookups — search, LinkedIn, etc.) call
  `spend()`; reads of the CRM's own database are explicitly free and
  uncounted (`instructions.md`: "Each session comes with a research budget,
  and only vendor calls spend it. Every read of our own CRM is free, however
  many you make.").
- Budget is **entirely in-memory, per-session state** (`eve`'s `defineState`,
  scoped to one running session/conversation) — it is never written back to
  Postgres, never aggregated across sessions/tasks, and there is no
  workspace-level or org-level spend cap or running total anywhere in the
  schema. `AgentTask.budget` is a static per-task allotment, not a ledger.
- Running out of budget is explicitly framed to the agent as a *normal*,
  non-failure outcome — "write up what you have and stop, or
  `schedule_recheck`" — not an error state.

### What's worth keeping (as a concept, not the implementation)

- **The "only paid calls spend budget, DB reads are free" split** is a good
  cost model for any agent doing internal-CRM-read + external-vendor-lookup
  work — worth carrying into Twenty's design even though the accounting
  itself needs to be durable there.
- **"Running out of budget is success, not failure"** as an explicit framing
  in the system prompt — a good UX/product principle: the agent is told to
  produce a partial, honest result and schedule a follow-up rather than
  either erroring out or burning unlimited spend chasing certainty.

### What NOT to port

- The mechanism itself (in-memory counter, no persistence, no cross-session
  aggregation, no actual dollar-cost tracking — it counts *call units*, not
  money) is not real cost accounting. If Twenty wants research budgets, it
  needs a durable per-workspace/per-record ledger with real persisted spend,
  not a per-session in-memory int. This repo's version would not survive a
  crashed session (spend is simply lost/reset) and cannot answer "how much
  have we spent on this account this month" — a real requirement Twenty
  should design for that this repo does not solve.

---

## 5. Record briefs

### Data model

```prisma
model ContactBrief {
  contactId String  @id
  narrative String
  sections  Json      // BriefSections, see below
  score     Float
  sourceUrl String?
  sessionId String?
  refreshedAt DateTime @default(now())
}
```

```ts
export type BriefSections = {
  currentRole?: string;
  tenure?: string;
  previousRoles?: string[];
  seniority?: string;
  function?: string;
  location?: string;
};
```

One brief per contact (`contactId` is the primary key — no history kept,
unlike facts; `write_brief` fully **replaces** the previous brief on every
call, there is no `SUPERSEDED` state for briefs). Gated by the same
`scoreEvidence()` pipeline as facts (§2): a brief with insufficient evidence
is refused outright (`"Nothing here is sourced well enough to put on the
record."`), and is written via `db.contactBrief.upsert()` inside
`writeBrief()` in `facts.ts`.

### Control flow / tool contract (`apps/agent/agent/tools/write_brief.ts` +
`apps/agent/agent/skills/writing-a-brief.md`)

- Hard **minimum length** on the narrative (`< 40` chars is rejected before
  even scoring) — the tool itself enforces "an empty panel is better than a
  padded one," per the skill doc's reasoning: at 40 characters there's no
  room to restate a field the rep can already see, so a too-short narrative
  is definitionally either empty or redundant.
- **Max length** capped at 400 chars via Zod schema (`MAX_NARRATIVE = 400`) —
  forces the "two or three sentences" tone described in the skill doc, not
  left to prompt-following alone.
- The skill doc prescribes an exact **shape and voice**: current role first,
  then prior roles, third person, present tense, name first, zero adjectives
  about the person ("seasoned", "passionate about", "well-regarded" are
  explicitly banned examples), with a concrete litmus test: *"could a rep
  repeat this sentence to the person on a call without embarrassment?"*
- Explicit instruction to **write nothing** rather than restate a field
  already visible elsewhere on the record — "An empty panel costs a rep
  nothing; a paragraph that restates a field they can already see costs them
  the time it takes to find that out."
- `sections` is deliberately sparse/optional per-field ("scanned, not read");
  an unknown field is left blank rather than guessed.

### Design decisions worth keeping

- **Evidence-gated, not just LLM-judged.** A brief is subject to the exact
  same evidence/scoring pipeline as a fact — it can't be written from
  unsourced narrative, keeping "what a rep reads before a call" as
  accountable as any single field.
- **Both a length floor and a length ceiling enforced in the tool schema**,
  not just prompted — turns a stylistic guideline (concise, no padding) into
  something structurally impossible to violate, which is more reliable than
  prompting alone.
- **"Write nothing" as an explicit, celebrated first-class outcome** — this
  repo repeatedly treats "no output" as success, not failure, for both facts
  (§2, `PROPOSED`/not-stored) and briefs. Worth carrying as a UX principle
  into any Twenty auto-brief feature: an agent that knows when to stay quiet
  is more trustworthy than one that always produces prose.
- **One brief per record, always replaced** (no versioning) is a deliberate
  simplicity choice appropriate for a "current state" panel — unlike facts,
  where history matters (job changes), a background summary is presented as
  "the current best narrative," and that's the right call to keep.

### What NOT to port

- No revision history on `ContactBrief` — if Twenty wants an audit trail of
  "what did the brief used to say," that has to be added; this repo doesn't
  need it because the brief is explicitly non-authoritative narrative, not a
  system of record.

---

## 6. Deferred capabilities — archival detail

> Everything below is DEFER or CUT in the program plan, which means it will
> **not** be built before this repo is deleted. These sections are therefore
> written as the complete surviving record: data model, control flow, failure
> semantics, and the decision worth keeping. Nothing here requires reopening
> `crm`.

### 6.1 Per-record enrichment status (triage row 22)

**Data model.** `enum EnrichmentStatus { PENDING RUNNING COMPLETE FAILED SKIPPED }`
(`packages/db/prisma/schema.prisma:123`). Three columns are mirrored onto
*both* `Contact` and `Company`:

```prisma
enrichmentStatus EnrichmentStatus @default(PENDING)
enrichedAt       DateTime?
enrichmentError  String?          // human-readable, shown in the UI
```

**Control flow** — the whole subsystem is one 45-line file,
`apps/agent/agent/lib/enrichment.ts`, with exactly two entry points:

```ts
markRunning(subject)              // write(subject, RUNNING, null, onlyIfRunning: false)
settle(subject, status, error?)   // write(subject, status, error, onlyIfRunning: true)
```

`write()` builds `{ enrichmentStatus, enrichmentError, ...(COMPLETE && { enrichedAt: now }) }`,
adds the guard `{ enrichmentStatus: RUNNING }` when `onlyIfRunning`, and applies
it with `updateMany` to whichever of `subject.contactId` / `subject.companyId`
is set. `subject` is the `TaskSubject` carried by the `AgentTask` row, so the
record status is always a projection of the queue, never set independently.

**Four failure semantics, each deliberate and each covered by a test in
`apps/agent/test/enrichment.integration.spec.ts`:**

1. **First terminal state wins.** `settle()` only fires against a row still in
   `RUNNING`. A tool that already wrote a *specific* terminal answer — e.g.
   `brand.ts` writing `SKIPPED / "No domain to look up."` — is not clobbered by
   the dispatcher's later generic `COMPLETE`. This is the entire reason for the
   `onlyIfRunning` parameter and it is the one non-obvious idea in the file:
   **the more specific answer, written first, outranks the more generic answer
   written later.**
2. **`markRunning` clears `enrichmentError`** (`error: null`, no guard), so a
   retry visibly resets the record rather than showing a stale failure reason
   next to a running spinner.
3. **`updateMany` (not `update`) is deliberate** — a record deleted while the
   agent was mid-session makes the settle a zero-row no-op instead of a
   `P2025 RecordNotFound` throw. Explicitly tested ("survives a record deleted
   while the agent was still reading about it").
4. **`PENDING` is the schema default**, so every newly created record is
   already correctly labelled "not yet looked at" with no backfill.

**Verdict unchanged (CUT / derive from `AgentTask` joins), with one caveat
worth recording:** a derived status can reproduce PENDING/RUNNING/COMPLETE/FAILED
from task rows, but it cannot reproduce `SKIPPED` + a specific
`enrichmentError` string, because "we deliberately did not try, and here is
why" is a *tool-level* judgement that never reaches the queue row. If Twenty
derives the chip from joins, it still needs somewhere to put that sentence.

### 6.2 Vendor enrichment pipelines (triage row 23)

Scouted as "just more `research_*` tools, no new pattern." Closer reading says
that is right about the *tools* and wrong about the *adapter contract*, which
is the part worth archiving.

**The vendor adapter contract.** Every external-vendor call in this repo
returns a three-way discriminated union rather than throwing
(`apps/agent/agent/lib/context-dev.ts`):

```ts
| { outcome: "found";   brand: Brand; raw: unknown }
| { outcome: "skipped"; reason: string }                    // nothing to do / not configured
| { outcome: "failed";  reason: string; retryable: boolean }
```

That union maps **1:1 onto the terminal `EnrichmentStatus` values** of §6.1,
which is why the enrichment writer needs no vendor-specific branching:
`found → COMPLETE`, `skipped → SKIPPED`, `failed → FAILED` (+ `retryable`
decides whether the `AgentTask` is worth another attempt). "Not configured"
and "vendor returned nothing" are both `skipped`, i.e. **an unconfigured
vendor is a normal outcome, not an error** — the same "no output is success"
stance §5 takes for briefs.

**The write policy: `stillFillable`** (`apps/agent/agent/lib/brand-mapping.ts:161`).
Vendor output is first mapped to a `BrandUpdate` of ~22 company columns
(`description, logoUrl, logoDarkUrl, iconUrl, iconDarkUrl, iconTone,
brandColor, industry, subIndustry, city, stateCode, country, countryCode,
phone, email, linkedinUrl, twitterUrl, githubUrl, pricingUrl, careersUrl`),
then filtered down to only the keys whose current value is empty:

```ts
for (const [key, value] of Object.entries(update))
  if (fillable(key, current)) next[key] = value;
```

Crucially the filter runs **inside** `db.$transaction`, against a `current`
snapshot re-read inside that transaction — not against the snapshot taken
before the (slow, network-bound) vendor call. This closes the window where a
human edits a field while the vendor request is in flight. Same principle as
§2's `humanOwns()` guard, applied to a bulk write instead of a single fact.
`name` gets one carve-out: it is fillable only when it is a placeholder
(`nameIsPlaceholder`), mirroring §2's derived-name exception.

**Asset mirroring** (`apps/agent/agent/lib/brand-images.ts`): every image URL
the vendor returns is copied into own blob storage at
`companies/{companyId}/{slot}` before being stored, so the CRM never renders a
hotlinked third-party asset that can rot or leak a referrer. Silently no-ops
when blob storage is unconfigured (`blobEnabled()`), leaving the vendor URL in
place — degraded, not broken.

**One small piece of real cleverness worth keeping** (`iconTone()`): the
vendor gives several logo variants; the code picks
`has_opaque_background → light → any`, then classifies the icon as
`opaque | dark | light | null` by computing saturation
`(max−min)/255` and luminance `0.299r+0.587g+0.114b`. If saturation > 0.12 it
returns `null` (a *coloured* icon is safe on any background, so don't tag it);
otherwise luminance < 0.2 → `dark`, > 0.8 → `light`. The point of the field is
to let the UI decide whether an icon needs a contrasting backdrop. Reusable
for any "we fetched a logo, will it disappear on dark mode" problem.

**Cost:** brand enrichment charges `spend(2)` (§4), i.e. one vendor pipeline is
worth two units of a default budget of four.

**Verdict unchanged (CUT until a vendor is chosen)** — but if Twenty ever
wires an enrichment vendor, reuse the three-way outcome union, the
re-read-inside-the-transaction `stillFillable` write, and the asset mirroring.
The vendor-specific field mapping is genuinely disposable.

### 6.3 Agent session-continuation bookkeeping (triage row 24)

**Data model** (`packages/db/prisma/schema.prisma:353`):

```prisma
model AgentConversation {
  id                String  @id @default(cuid())
  contactId/companyId/dealId  String?   // exactly one, all onDelete: Cascade
  userId            String                        // owner; onDelete: Cascade
  sessionId         String  @unique               // the runtime's session id
  continuationToken String?                       // opaque resume bookmark
  streamIndex       Int     @default(0)           // last event index rendered
  title             String?                       // first 120 chars of turn 1
  messageCount      Int     @default(0)
  createdAt / lastMessageAt DateTime
  @@index([contactId, lastMessageAt]) // + companyId, dealId
}
```

**The key realisation: this table stores no transcript.** Messages live
entirely inside the third-party `eve` session runtime. This row is (a) an index
answering "which agent conversations exist on this record, newest first"
(`conversations.service.ts`, `take: 20`, cached with a short TTL) and (b) a
three-field **resume bookmark** `(sessionId, continuationToken, streamIndex)`.
The browser (`apps/app/components/crm/agent-panel.tsx`) upserts the bookmark on
`sessionId:token:messageCount` change and, on reload, replays from
`streamIndex` instead of from zero. Ownership is enforced on write
(`conversation.userId !== userId → BadRequest`), not only on read.

**The genuinely reusable idea is what `continuationToken` is *used for***
(`apps/agent/agent/channels/crm.ts`). It is not just an opaque runtime handle —
this repo overloads it as the **correlation key that ties a fire-and-forget
agent session back to its queue row**:

```ts
taskToken(taskId)      = `task:${taskId}`
taskFromToken(token)   = token.slice(token.lastIndexOf("task:") + 5) || null
```

The dispatcher sends each task's brief with `continuationToken: taskToken(task.id)`;
ad-hoc (human-initiated) sessions get `crm:adhoc:${uuid}` instead, so the same
handler distinguishes queue work from chat work by prefix alone. Completion is
then driven by two runtime events, **not** by the dispatcher awaiting anything:

- `session.waiting` (the agent has gone idle awaiting input) → `completeTask(taskId, "ran")`
  → `settle(subject, COMPLETE)`. **"The agent stopped talking" is the success
  signal** — there is no explicit "I am done" tool call to forget to emit.
- `turn.failed` → `settle(subject, FAILED, reason)`. Note this settles the
  *record* but does **not** complete the task, so the lease expiry (§1) makes it
  retryable — the two failure paths are deliberately different.

**Verdict unchanged (CUT — coupled to `eve`).** But archive the pattern: an
async agent session needs *one* opaque string threaded through it that names
the durable row it is working on, and an idle/quiet event is a more reliable
completion signal than a tool the model must remember to call.

### 6.4 Email and calendar ingestion (triage row 25)

Program disposition says "BUILT on Twenty's existing messaging/calendar
entities — nothing new modelled." The entities are indeed replaceable. The
**sync-state machine and the auto-create policy** are not, and are recorded
here in full.

#### Data model

```prisma
enum GoogleSyncStatus { IDLE RUNNING NEEDS_RECONNECT FAILED }
enum EmailDirection   { INBOUND OUTBOUND }

model MailboxSync {              // one row per (user, source)
  userId String; source String   // @@unique([userId, source]); @@index([status])
  status       GoogleSyncStatus @default(IDLE)
  cursor       String?           // Gmail historyId / Calendar syncToken
  lastSyncedAt DateTime?
  lastError    String?
  retryAfter   DateTime?         // rate-limit backoff gate
  autoCreate   Boolean @default(false)   // may this mailbox mint CRM records?
}

model EmailThread  { rootMessageId String @unique; subject; companyId?; contactId?;
                     firstMessageAt; lastMessageAt; messageCount }
model EmailMessage { rfcMessageId String @unique; gmailMessageId String?;
                     threadId; direction; fromEmail; fromName?; recipients Json;
                     subject?; snippet?; body?; sentAt; syncedByUserId? }
model CalendarEvent { iCalUid; originalStartTime; recurringEventId?;
                      @@unique([iCalUid, originalStartTime]) ... }
model CalendarAttendee { eventId; email; responseStatus?; isOrganizer;
                         contactId?; @@unique([eventId, email]) }
```

Three separate uniqueness keys do all the idempotency work, and each is chosen
for a different reason: `rfcMessageId` (the RFC-5322 `Message-ID`) is stable
across mailboxes and re-syncs; `gmailMessageId` is the provider handle used for
the cheap pre-filter; `(iCalUid, originalStartTime)` is what makes **one
occurrence of a recurring meeting** a row, rather than the series.

#### Scheduler (`apps/api/src/google/sync-state.service.ts`)

`due(now)` selects every sync row **except** `NEEDS_RECONNECT`, where
`retryAfter IS NULL OR retryAfter <= now`, ordered by `lastSyncedAt ASC NULLS FIRST`
(never-synced mailboxes go first). Five transitions, each its own tiny method:
`markRunning` (clears `lastError`), `settle` (writes cursor + `lastSyncedAt`,
clears error *and* `retryAfter`), `clearCursor` (cursor → null, status → IDLE),
`markNeedsReconnect` (terminal until the user re-auths; clears `retryAfter` so
it can never be picked up again by the scheduler), `markRateLimited`
(status → IDLE, `retryAfter = now + retryAfterMs`).

**`NEEDS_RECONNECT` is excluded from `due()` rather than given a far-future
`retryAfter`** — a broken OAuth grant is a human-action state, not a backoff
state, and conflating the two is how sync systems end up hammering a revoked
token forever.

#### Gmail control flow (`gmail-sync.service.ts`)

1. Get a token. `not-connected` → skip (no state change). `needs-reconnect` →
   `markNeedsReconnect` and stop.
2. `markRunning`, fetch profile, read the mailbox address (used to decide
   `direction`).
3. **No cursor → `start()`: record the *current* `historyId` and return.**
   There is deliberately **no historical backfill** — the first sync means
   "watch from now on." Cheap, bounded, and avoids importing years of
   pre-CRM mail. If the provider returns no `historyId`, that is a hard
   `markFailed`.
4. Cursor present → `listHistory(startHistoryId)`.
   - `cursor-invalid` (Gmail expires history after ~1 week) → `clearCursor()`
     and **return success** with reason `"History expired; resuming from now."`
     A gap in coverage is treated as normal operation, not a failure.
   - otherwise collect `history[].messagesAdded[].message.id` into a `Set`.
5. `ingest()`: drop ids already present (`emailMessage.gmailMessageId IN (...)`),
   take at most `MAX_MESSAGES_PER_TICK`, count the rest as `remaining`.
6. **Cursor advances only when `remaining === 0`.** If the tick was truncated,
   the cursor stays at `startHistoryId`, so the next tick re-reads the same
   history window. This is deliberate at-least-once delivery, made safe by the
   unique keys in step 5 and by `rfcMessageId @unique`. Simpler and more robust
   than a partial-progress cursor.

#### The auto-create policy — the part actually worth porting

`store()` decides record linkage **once per thread**, at thread creation, then
every later message inherits the thread's `companyId`/`contactId` (no
re-matching per message, so a thread cannot drift between companies).

```ts
const repliedTo = outbound || await hasOutboundInThread(rootId, mailbox);
const match = await this.match.resolve(
  { participants, allowCreate: row.autoCreate && repliedTo,
    source: RecordSource.EMAIL, ownerId: row.userId }, context);
if (!companyId && !contactId) return false;   // message dropped entirely
```

Two rules, both load-bearing:

- **Reciprocity gate.** A new contact/company is minted only if the workspace
  has *itself sent* something into that thread. Inbound-only mail (cold
  outreach, newsletters, receipts) is never allowed to create CRM records even
  when `autoCreate` is on. `autoCreate` is per-mailbox and defaults `false`.
  The calendar equivalent is `row.autoCreate && !declinedByUs`.
- **No match, no row.** If resolution produces neither a company nor a contact,
  the message is not stored at all. There is no orphan-mail table.

#### The participant filter (triage row 26 — and this row was mis-scouted)

`SuppressedDomain { domain @id, reason?, createdAt }` and
`SuppressedContact { email @id, reason?, createdAt }` were scouted as
"do-not-contact lists for outbound." **They are not.** Grep shows their only
consumers are `gmail-sync.service.ts`, `calendar-sync.service.ts` and
`google-match.service.ts` — they are the tenant-editable layer of an **inbound
ingestion noise filter**, `externalParticipants()` in
`apps/api/src/google/participants.ts`:

```ts
participants.filter(p =>
  !ourAddresses.has(p.email)          // our own staff
  && !suppressedEmails.has(p.email)   // tenant-curated denylist
  && !isMachineAddress(p.email)       // opaque machine-generated identities
  && workDomain(p.email) !== null     // has a real work domain at all
  && !ourDomains.has(domain)          // internal mail
  && !suppressedDomains.has(domain)   // tenant-curated domain denylist
  && !isAutomatedAddress(p.email));   // role/no-reply addresses
```

The four hardcoded layers underneath the two tenant-editable ones, all in
`participants.ts` + `apps/api/src/companies/domain.ts`:

1. **~32 automated local-parts** — `noreply, no-reply, donotreply, notifications,
   mailer-daemon, postmaster, bounce(s), auto-confirm, automated,
   calendar-invite, invite(s), invitations, meetings, scheduling, booking(s),
   reply, support, help, hello, info, contact, sales, billing, accounts, team`,
   matched as `local === p || local.startsWith(p + "-"|"+"|"_")` so
   `support+123@` and `noreply-eu@` are caught too.
2. **Opaque local-parts** — `/^(c_)?[0-9a-f]{24,}$/` and a bare-UUID regex.
   These are Google Calendar's resource/room pseudo-addresses.
3. **~21 free-email domains** (`gmail, yahoo, hotmail, outlook, icloud, proton,
   gmx, qq, 163, yandex`, …) — `domainFromEmail()` returns `null` for them, so a
   personal address never *creates a company*. It can still be a contact; it
   just carries no employer signal.
4. **Machine domains/suffixes** — `calendar.google.com, googlegroups.com,
   docs/drive.google.com, appspotmail.com, amazonses.com, sendgrid.net,
   zoomcrc.com` plus suffixes `.calendar.google.com, .bounces.google.com,
   .appspotmail.com, .amazonses.com, .sendgrid.net, .invalid, .local,
   .localhost`.

And `dominantDomain(participants, preferKnown)` picks the company a
multi-participant thread/meeting belongs to: `score = count*2 + (known ? 1 : 0)`
— majority domain wins, with a one-point thumb on the scale for a domain
already in the CRM, so a 2-vs-2 meeting resolves to the existing customer
rather than coin-flipping.

**This changes the disposition.** Suppression lists are not an outbound-sending
concern that can wait for outbound sending; they are a **precondition for
inbound ingestion producing clean records**, which the program marks BUILT for
Phase 3 (T3/T4). Recorded as such in the triage table below.

## 7. Not worth porting (reclassified on closer reading)

Both items below were previously DEFER rows. Neither survives a second look as
a capability worth rebuilding; the one or two ideas inside them are recorded
here in full so nothing is lost by deleting the repo.

### 7.1 Relevance-scored CRM search (was triage row 21)

`apps/agent/agent/lib/lookup.ts` (`searchCrm`) is a ~250-line hand-rolled
search over three entity types. It is not worth porting: Twenty has record
search, and this implementation has no index behind it (`contains` +
`mode: "insensitive"` = sequential scan on every column) — it would be a
regression at any real data volume.

Two ideas inside it are worth remembering in one paragraph each:

- **Over-fetch in SQL, rank in memory.** Recall is done by a broad `OR` of
  `contains` clauses ordered by `lastActivityAt DESC`, taking `limit * 3`;
  precision is then done in application code by re-scoring and slicing to
  `limit`. The database is asked for *candidates*, not for *ranking* — which
  sidesteps needing a tsvector/ranking function at all for a small dataset.
- **The tiered score.** Per candidate, across a small set of fields
  (`name, email, company.name` for contacts), take the best of:
  exact = 4, prefix = 3, substring = 2. Only if all three miss does it fall
  back to a fractional word-overlap score (`matched words / total words`,
  always < 1), so **any literal match always outranks every partial match** —
  no weight tuning needed to guarantee that. Queries shorter than 2 chars
  return empty; an `@` in the query enables an exact-email clause; a bare
  `host.tld` shape enables a domain clause.

### 7.2 `AppSetting` singleton (was triage row 27)

`packages/db/src/settings.ts` + `model AppSetting`. A single row with a fixed
primary key (`SETTINGS_ID = "app"`) holding `agentModelId`,
`agentModelContextWindow`, and `contextDevApiKey`. Read/write are four
`findUnique`/`upsert` helpers; an unset `agentModelId` falls back to a
hardcoded `DEFAULT_AGENT_MODEL` with an `isDefault: true` flag so the UI can
say "using the default" rather than showing a blank.

Not worth porting, and this is now a firm "never," not a deferral:

- It is structurally single-tenant. Twenty's equivalents (workspace settings,
  connected-account credentials, feature flags) are all workspace-scoped;
  a fixed-id row cannot be made multi-tenant without becoming a different table.
- **The vendor API key is stored in plaintext in a Postgres column.** The only
  protection is `maskKey()` (`••••` + last 4) at the presentation layer. Twenty
  must not copy this; it already has encrypted credential storage.

The single idea worth keeping is one line: pair a nullable stored model id with
a hardcoded default and return an `isDefault` flag, so "unconfigured" and
"explicitly configured to the same value" stay distinguishable in the UI.

---

## Overall recommendation

**Port as design (not code):**
1. The evidence-kind → weight table → noisy-OR → band-floor → primary-gate
   fact-scoring pipeline (§2) — this is the single highest-value idea in the
   repo and is stack-agnostic.
2. The lease-based `SELECT ... FOR UPDATE SKIP LOCKED` durable task-claim
   pattern (§1), generalized to whatever job table Twenty builds.
3. The "suggestion, not silence" principle applied consistently to facts,
   identity matches, and briefs — never auto-discard low-confidence findings,
   never auto-apply them either; surface them as a decision for a human.
4. The identity-matching two-factor (employer + name), both-required verdict
   procedure, and its "guess the query, never the answer" principle (§3).
5. The brief-writing constraints (length floor/ceiling, banned adjectives,
   "write nothing" as success) as product/UX guidance for any Twenty
   auto-generated summary feature (§5).
6. The "DB reads are free, vendor calls cost budget" cost model as a
   framing principle for any Twenty research-agent budget feature (§4),
   reimplemented with durable persistence.

**Do NOT port:**
- The literal Prisma schema/columns — Twenty's data model, tenancy, and
  ORM are fundamentally different.
- The `eve` framework dependency and its state/session primitives
  (`defineState`, `defineDynamic`) — third-party, not this repo's IP.
- The in-memory, per-session, non-durable budget accounting (§4) — copy the
  concept, not the mechanism; it's under-built for real cost tracking.
- The specific evidence-kind vocabulary and weight constants — tuned to this
  product's specific vendors (LinkedIn, Gmail sync); Twenty will need its own
  vocabulary matched to its own data sources.
- Any expectation of a deterministic fuzzy-matching identity algorithm — it
  doesn't exist here; identity resolution is agent-procedural, not a
  reusable function, and Twenty will need to build real deterministic dedup
  separately if that's a hard requirement.
- `AgentTask.budget` as a literal column semantics — it's dead weight beyond
  being a session-start parameter; don't assume it's a ledger.
- The implicit (non-)cancellation of tasks (§1) — a known gap, not a pattern
  to repeat; Twenty should design explicit cancellation into its job model.

## Ranked inventory with explicit dispositions (per charter's triage rule)

| # | Capability | Value | Disposition | Reason / trigger |
|---|---|---|---|---|
| 1 | Lease-based claim SQL (`FOR UPDATE SKIP LOCKED`, time-based lease, attempts-on-claim) | Very high | BUILD NOW | Core of charter's Execution contract (leased, retryable); DB-native, no broker needed. |
| 2 | Two-lane dispatch (direct/no-LLM kinds vs research/LLM-session kinds) | High | BUILD NOW | Matches budget-discipline requirement; cheap deterministic work shouldn't pay session overhead. |
| 3 | Attempts-capped + explicit exhaustion sweep with human-readable outcome | High | BUILD NOW | Matches retry requirement; keep as two small ops, not one state machine. |
| 4 | Real backoff on retry | — | BUILD NOW (new) | Gap in source (immediate re-eligibility on lease expiry); charter explicitly requires backoff. |
| 5 | Explicit task cancellation (`cancelledAt`) | — | BUILD NOW (new) | Gap in source (implicit-only); charter requires cancellable tasks. |
| 6 | Idempotent upsert-scheduling keyed on (kind, subject) | Medium-high | BUILD NOW | Cheap dedup; maps to charter's idempotency-key requirement. |
| 7 | Guarded completion (`updateMany` with `finishedAt: null`) | Medium | BUILD NOW | Simple idempotent-write pattern, prevents stale/duplicate session overwrite. |
| 8 | Evidence-kind → weight table → noisy-OR → band floor → primary-gate scoring | Very high | BUILD NOW | Best-designed mechanism in repo; directly is the charter's evidence→fact confidence model. Port mechanism, not literal weights/kinds. |
| 9 | First-class `Evidence` entity separate from `Fact` (immutable observation, linked not embedded) | Very high | BUILD NOW (improve on source) | Source embeds evidence as JSON on the fact row; charter's separate immutable-Evidence + derived-Fact-with-links is strictly better (shared observations, independent audit) — build the charter's shape, not this repo's collapsed one. |
| 10 | Confidence-band-driven apply-vs-propose split (VERIFIED auto-applies, PROBABLE/POSSIBLE become review-only) | Very high | BUILD NOW | This is the evidence→fact→proposal chain in miniature; map onto Fact + Proposal/ProposalItem. |
| 11 | Permanent dismissal memory (never re-propose an exact value a human rejected) | High | BUILD NOW | Cheap, real trust-preservation; prevents "AI keeps suggesting what I said no to." |
| 12 | Human-authorship supremacy (agent never overwrites a manually entered field, narrow derived-name exception) | High | BUILD NOW | Matches charter's approval ethos extended to "never silently override a human entry." |
| 13 | Supersession-not-deletion history on facts | High | BUILD NOW | Directly matches charter's "current or superseded" Fact requirement. |
| 14 | Two-factor (employer+name) both-required identity verdict, "guess the query never the answer" principle | High | BUILD NOW — design fresh | Named target capability; source has no deterministic algorithm, only an LLM procedure plus DB unique constraints (`Company.domain`, `Contact.email`). Reuse the *principle*, build Twenty's actual deterministic resolver from scratch per the charter's "Lead to qualified opportunity" step 2. |
| 15 | Record brief: narrative + structured sections, evidence-gated, length floor/ceiling, "write nothing" as success | High | BUILD NOW | Directly is the charter's "record briefs" deliverable. |
| 16 | Workspace-level self-profile brief (`WorkspaceProfile`, same shape, describes the tenant org itself) | Medium | BUILD NOW | Cheap, reusable context for every outreach/prep task; not one of the charter's six named entities but fits naturally as a workspace-scoped Fact/Brief pair. |
| 17 | "DB reads free, vendor calls cost budget" cost-model framing | High | BUILD NOW (concept only) | Good cost model to reuse; source implementation is in-memory/non-durable — build durable version. |
| 18 | Durable per-workspace/per-record cost ledger (real $ + token accounting) | — | BUILD NOW (new, charter already requires it on AgentRun) | Source's budget is an in-memory call-count int, lost on crash, no aggregation — real gap versus charter's `AgentRun` cost/token fields. |
| 19 | `sensitiveWrite` tool-level approval gate (automated principal more restricted than interactive session) | High | BUILD NOW (folds into Proposal/Principal contracts) | Reinforces charter's principle that some actions are agent-forbidden outright, not just proposal-gated; keep as a policy dimension on tool/ProposalItem definitions. |
| 20 | Priority set at schedule time via a static per-kind table | Low-medium | BUILD NOW (as starting policy) | Simple, legible default; port the idea (tunable table by task kind), not the exact numbers. |
| 21 | Plain relevance-scored CRM search (`searchCrm`, exact>prefix>substring>word-overlap) | Low | **NOT WORTH PORTING** (was DEFER) | Reclassified — see §7.1. Unindexed `contains` scans over three entity types; would be a regression at volume. The two reusable ideas (over-fetch-then-rank-in-memory; tiered score where any literal match outranks every partial match) are recorded there in full. Nothing left to revisit. |
| 22 | Per-record `EnrichmentStatus` enum mirrored onto Contact/Company | Medium | DEFER — **fully documented, §6.1** | Still derive from `AgentTask`/`AgentRun` joins. One caveat recorded: a derived status cannot reproduce `SKIPPED` + a specific `enrichmentError` sentence, which is a tool-level judgement that never reaches the queue row. Also archived: the `onlyIfRunning` compare-and-set ("first, more specific terminal state wins") and the `updateMany`-tolerates-deleted-record choice. |
| 23 | Vendor-specific enrichment pipelines (brand/logo, portrait/headshot, context.dev, LinkedIn scraping, Perplexity) | Low as tools, **medium as an adapter contract** | DEFER — **fully documented, §6.2** | The tools are disposable; the contract is not. Archived: the `found｜skipped｜failed{retryable}` vendor union mapping 1:1 onto terminal enrichment states, the `stillFillable` fill-only-empty write re-read *inside* the transaction, own-blob asset mirroring, and the `iconTone` saturation/luminance heuristic. Trigger: when a specific enrichment vendor is chosen. |
| 24 | `AgentConversation`/session continuation bookkeeping (`sessionId`, `continuationToken`, `streamIndex`) | Medium | DEFER — **fully documented, §6.3** | Still coupled to `eve`. Archived because two ideas outlive it: the table stores a *bookmark, not a transcript*, and `continuationToken` doubles as the correlation key tying a fire-and-forget session back to its queue row — with `session.waiting` (the agent went quiet) as the completion signal instead of a tool the model must remember to call. |
| 25 | Email/calendar ingestion (`MailboxSync`, `EmailThread`, `EmailMessage`, `CalendarEvent`, `CalendarAttendee`) | Medium as entities, **high as a sync state machine + auto-create policy** | DEFER — **fully documented, §6.4** | The entities map onto Twenty's existing messaging/calendar. What does *not* map, and is archived in full: the five-transition `MailboxSync` state machine (incl. `NEEDS_RECONNECT` excluded from the due-query rather than back-off-scheduled), watch-from-now with no historical backfill, expired-cursor treated as success, cursor advancing only when a tick drains fully (at-least-once + unique-key dedupe), and the three uniqueness keys and why each was chosen. |
| 26 | `SuppressedDomain`/`SuppressedContact` | Medium-high | DEFER — **mis-scouted; corrected in §6.4** | **These are not do-not-contact lists for outbound.** Their only consumers are the Gmail/Calendar sync services: they are the tenant-editable layer of an *inbound ingestion noise filter* (`externalParticipants()`), sitting on top of four hardcoded layers — ~32 automated local-parts, opaque/UUID local-parts, ~21 free-email domains, machine domains/suffixes — plus the `dominantDomain` majority-vote-with-known-domain-bonus and the `autoCreate && repliedTo` reciprocity gate. The original trigger ("when outbound send workflows are built") is wrong and would never fire; the real trigger is **the same phase that builds inbound ingestion**. |
| 27 | `AppSetting` singleton (model selection, vendor API keys) | None | **NOT WORTH PORTING** (was DEFER) | Reclassified to a firm never — see §7.2. Structurally single-tenant (fixed `id = "app"`), and it stores the vendor API key in **plaintext** with only a `maskKey()` presentation-layer mask. One line worth keeping (nullable stored value + hardcoded default + `isDefault` flag) is recorded there. |

## Key files referenced

- `packages/db/prisma/schema.prisma` (models: `AgentTask`, `AgentEvent`,
  `AgentConversation`, `ContactFact`, `ContactBrief`, `Contact`, `Company`,
  `CompanyEnrichment`, enums `FactBand`, `FactStatus`, `EnrichmentStatus`)
- `packages/db/src/agent-tasks.ts` (`TASK_KINDS`, `DIRECT_KINDS`, `PRIORITY`)
- `apps/agent/agent/lib/tasks.ts` (claim/lease/complete/schedule SQL)
- `apps/agent/agent/lib/dispatch.ts` (two-lane executor loop)
- `apps/agent/agent/lib/evidence.ts` (scoring pipeline)
- `apps/agent/agent/lib/facts.ts` (`recordFact`, `writeBrief`, supersession,
  human-ownership guard)
- `apps/agent/agent/lib/focus.ts` (session budget accounting)
- `apps/agent/agent/lib/enrichment.ts` (status write-back with `onlyIfRunning`
  guard)
- `apps/agent/agent/lib/preamble.ts` (per-session context assembly)
- `apps/agent/agent/instructions/task.ts` (session-start budget wiring)
- `apps/agent/agent/tools/identify_contact.ts`,
  `apps/agent/agent/tools/write_brief.ts`
- `apps/agent/agent/skills/identity-matching.md`,
  `apps/agent/agent/skills/evidence.md`,
  `apps/agent/agent/skills/writing-a-brief.md`
- `apps/agent/agent/instructions.md` (budget framing, evidence-source
  precedence)

Additional files read for the deferred-capability archive (§6–§7):

- `apps/agent/agent/lib/enrichment.ts` + `apps/agent/test/enrichment.integration.spec.ts`
  (§6.1 — the `onlyIfRunning` guard and its four tested failure semantics)
- `apps/agent/agent/lib/brand.ts`, `brand-mapping.ts`, `brand-images.ts`,
  `context-dev.ts` (§6.2 — vendor outcome union, `stillFillable`, mirroring,
  `iconTone`)
- `apps/agent/agent/channels/crm.ts` (§6.3 — `taskToken`/`taskFromToken`,
  `session.waiting` / `turn.failed` handlers)
- `apps/api/src/conversations/conversations.service.ts`,
  `apps/app/components/crm/agent-panel.tsx` (§6.3 — bookmark persistence and
  `streamIndex` replay)
- `apps/api/src/google/sync-state.service.ts`, `gmail-sync.service.ts`,
  `calendar-sync.service.ts`, `google-match.service.ts`, `participants.ts`,
  `apps/api/src/companies/domain.ts` (§6.4 — sync state machine, auto-create
  policy, participant filter)
- `apps/agent/agent/lib/lookup.ts` (§7.1), `packages/db/src/settings.ts` (§7.2)
