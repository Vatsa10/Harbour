# Environment variables — AI-Native CRM

Target stack: **Neon** (PostgreSQL) + **Upstash** (Redis) + your own compute.

Everything here is verified against `packages/searm-server/src/engine/core-modules/searm-config/config-variables.ts` and `packages/searm-server/src/database/scripts/setup-db.ts` in this fork. Where I flag a risk, it is a real one, not boilerplate caution.

---

## 1. Read this before buying anything

Two decisions in your chosen stack will bite, and both are cheap to get right up front.

### Upstash + BullMQ is the expensive one

SeaRM runs **BullMQ** for every background job: message sync, calendar sync, cron dispatch, and — in our Phase 2 work — the durable agent-task worker. BullMQ workers hold **blocking** connections (`BZPOPMIN`/`BRPOPLPUSH`) and poll continuously.

Upstash bills **per command**. An idle BullMQ worker still issues a steady stream of commands, so a queue that processes nothing can still generate millions of requests a month. Upstash also caps concurrent connections per plan, and SeaRM opens several (cache, each queue, each worker replica).

**SeaRM already has the escape hatch — use it.** `REDIS_QUEUE_URL` exists precisely to split cache from queues:

| Variable | Point it at | Why |
| --- | --- | --- |
| `REDIS_URL` | Upstash | Cache and sessions — request-shaped traffic, exactly what Upstash is good at |
| `REDIS_QUEUE_URL` | A dedicated always-on Redis | BullMQ — connection-shaped traffic, priced per instance not per command |

For the dedicated queue Redis, anything with a flat monthly price works: Railway, Fly.io, DigitalOcean Managed Redis, Redis Cloud's fixed tier. A 256 MB instance is plenty.

If you want to start with Upstash for both, do it — but **watch the command count in week one**, before it becomes a surprise.

### Neon: use the DIRECT endpoint, not the pooled one

Neon gives you two connection strings. The pooled one runs PgBouncer in transaction mode, which breaks prepared statements and any session-scoped state. SeaRM uses TypeORM with prepared statements and switches schemas per workspace — it is exactly the workload PgBouncer transaction mode does not support.

- Use the **direct / unpooled** endpoint for `PG_DATABASE_URL`.
- Control concurrency with `PG_POOL_MAX_CONNECTIONS` instead, sized under Neon's per-plan connection limit.
- Turn **autosuspend off** (or set a long timeout). Scale-to-zero means a cold start on the first query after idle, and the background worker will wake it constantly anyway, so autosuspend buys you nothing here.
- Neon presents a valid certificate, so keep `PG_SSL_ALLOW_SELF_SIGNED=false` and append `?sslmode=require`.

**Extensions:** SeaRM needs only `uuid-ossp` and `unaccent`. Both are available on Neon and are created automatically by `setup-db`. The `wrappers` / `mysql_fdw` / `postgres_fdw` extensions in that script are gated behind `IS_FDW_ENABLED` and skipped by default — leave that flag unset and Neon is fine.

---

## 2. Minimum to boot

Nothing starts without these five.

```bash
NODE_ENV=production
PG_DATABASE_URL=postgresql://USER:PASSWORD@ep-xxx.REGION.aws.neon.tech/dbname?sslmode=require
REDIS_URL=rediss://default:PASSWORD@xxx.upstash.io:6379
APP_SECRET=            # 32+ random bytes, e.g. openssl rand -base64 32
SERVER_URL=https://api.yourdomain.com
```

`APP_SECRET` signs every token. **Rotating it logs out every user and invalidates every pending session** — generate once, store in a secret manager, never regenerate casually.

Note `rediss://` (two s) for Upstash — TLS is mandatory and the config validator only accepts `redis`/`rediss` schemes.

---

## 3. Core production set

```bash
# --- Identity / URLs ---
NODE_ENV=production
APP_SECRET=
SERVER_URL=https://api.yourdomain.com
FRONTEND_URL=https://app.yourdomain.com
PORT=3000
SERVER_KEEP_ALIVE_TIMEOUT_MS=65000   # keep ABOVE your load balancer idle timeout

# --- Database (Neon, direct endpoint) ---
PG_DATABASE_URL=postgresql://...?sslmode=require
PG_SSL_ALLOW_SELF_SIGNED=false
PG_POOL_MAX_CONNECTIONS=10           # sum across ALL replicas must stay under Neon's cap
PG_POOL_IDLE_TIMEOUT_MS=600000
# PG_DATABASE_REPLICA_URL=           # optional read replica

# --- Redis ---
REDIS_URL=rediss://default:...@....upstash.io:6379          # cache/sessions
REDIS_QUEUE_URL=rediss://...                                # queues — see section 1

# --- Workspace model ---
IS_MULTIWORKSPACE_ENABLED=false      # true only if you host multiple tenants on one instance
IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS=true
SIGN_IN_PREFILLED=false              # MUST be false in production

# --- Storage ---
STORAGE_TYPE=s3
STORAGE_S3_REGION=
STORAGE_S3_NAME=
STORAGE_S3_ENDPOINT=                 # set for R2/MinIO/Backblaze; omit for real AWS
# Credentials come from the AWS SDK chain (IAM role, or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)
```

`STORAGE_TYPE=local` works for a single box but breaks the moment you run two replicas or redeploy a container — attachments and profile pictures live on that disk. Use S3 or an S3-compatible service (Cloudflare R2 is the cheap option) for anything real.

---

## 4. AI providers — required for our phases

The trust layer, the evidence pipeline, and the support agent all need at least one model provider. **Without a key here, Phase 2 does nothing** — the research agent cannot run, so no evidence is recorded and no proposals are generated.

```bash
ANTHROPIC_API_KEY=
# and/or
OPENAI_API_KEY=
GOOGLE_API_KEY=
XAI_API_KEY=
GROQ_API_KEY=
MISTRAL_API_KEY=
```

SeaRM splits models into a "fast" and a "smart" slot per workspace, with defaults in `AI_MODELS_DEFAULT_FAST` / `AI_MODELS_DEFAULT_SMART`. Set at least one provider whose models cover both. Anthropic alone is sufficient.

Cost control worth knowing: every agent run records token and cost usage on `AgentRun`, and `AgentTask` carries a per-task budget. That is our accounting, not the provider's — set budgets deliberately rather than discovering spend on the invoice.

---

## 5. Authentication

At minimum, one method must work.

```bash
AUTH_PASSWORD_ENABLED=true
IS_EMAIL_VERIFICATION_REQUIRED=true

# Google (also required for Gmail/Calendar sync)
AUTH_GOOGLE_ENABLED=true
AUTH_GOOGLE_CLIENT_ID=
AUTH_GOOGLE_CLIENT_SECRET=
AUTH_GOOGLE_CALLBACK_URL=https://api.yourdomain.com/auth/google/redirect
AUTH_GOOGLE_APIS_CALLBACK_URL=https://api.yourdomain.com/auth/google-apis/get-access-token

# Microsoft
AUTH_MICROSOFT_ENABLED=false
AUTH_MICROSOFT_CLIENT_ID=
AUTH_MICROSOFT_CLIENT_SECRET=
AUTH_MICROSOFT_CALLBACK_URL=https://api.yourdomain.com/auth/microsoft/redirect
AUTH_MICROSOFT_APIS_CALLBACK_URL=https://api.yourdomain.com/auth/microsoft-apis/get-access-token

# Token lifetimes (defaults are sane)
ACCESS_TOKEN_EXPIRES_IN=30m
LOGIN_TOKEN_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=90d
FILE_TOKEN_EXPIRES_IN=1d
```

The OAuth callback URLs must match what you register in Google Cloud Console / Azure **exactly**, including scheme and trailing path.

---

## 6. Email

Needed for verification, invitations, password reset — and it is the **only** notification mechanism that exists. There is no in-app notification system in SeaRM, so if you want to be told a proposal is waiting for review, it arrives by email or not at all.

```bash
EMAIL_DRIVER=smtp
EMAIL_FROM_ADDRESS=noreply@yourdomain.com
EMAIL_FROM_NAME=Your CRM
EMAIL_SYSTEM_ADDRESS=system@yourdomain.com
EMAIL_SMTP_HOST=
EMAIL_SMTP_PORT=587
EMAIL_SMTP_USER=
EMAIL_SMTP_PASSWORD=
```

---

## 7. Messaging and calendar sync — Phase 3 input

Phase 3's ingestion pipeline consumes these. Leave them off until Phase 3 is finished and reviewed.

```bash
MESSAGING_PROVIDER_GMAIL_ENABLED=true
CALENDAR_PROVIDER_GOOGLE_ENABLED=true
MESSAGING_PROVIDER_MICROSOFT_ENABLED=false
CALENDAR_PROVIDER_MICROSOFT_ENABLED=false
IS_IMAP_SMTP_CALDAV_ENABLED=false
```

**Privacy note tied to a decision still open for you.** When Phase 3 ships, ingested message bodies and call-recording content are sent to your configured LLM provider for extraction. Our design adds a **per-connected-account exclusion toggle** so a given mailbox can be kept out. That is product behaviour, not an env var — but enabling these providers is what starts the flow, so decide the policy before you flip them on.

---

## 8. Observability and ops

```bash
LOG_LEVELS=error,warn
LOGGER_DRIVER=CONSOLE
EXCEPTION_HANDLER_DRIVER=sentry
SENTRY_DSN=
SENTRY_FRONT_DSN=
SENTRY_ENVIRONMENT=production

# Worker: split queues across dedicated worker pods if you scale out
# WORKER_ENABLED_QUEUES=workspace-queue,cron-queue
```

---

## 9. Leave these OFF

```bash
IS_BILLING_ENABLED=false     # SeaRM Cloud's Stripe billing; irrelevant self-hosted
IS_FDW_ENABLED=              # unset — the extensions it needs do not exist on Neon
SIGN_IN_PREFILLED=false      # dev convenience; a security hole in production
```

---

## 10. What to actually go collect

| # | Item | Where | Notes |
| --- | --- | --- | --- |
| 1 | Neon project + **direct** connection string | neon.tech | Autosuspend off. Note the connection cap on your plan. |
| 2 | Upstash Redis (cache) | upstash.com | `rediss://` URL |
| 3 | Dedicated Redis (queues) | Railway / Fly / DO | See section 1 — the BullMQ cost trap |
| 4 | `APP_SECRET` | `openssl rand -base64 32` | Generate once, store in a secret manager |
| 5 | Anthropic API key | console.anthropic.com | Without this the AI layer is inert |
| 6 | S3 bucket + credentials | AWS S3 or Cloudflare R2 | R2 has no egress fees |
| 7 | SMTP credentials | Postmark / SES / Resend | Also your only notification channel |
| 8 | Google OAuth client | console.cloud.google.com | Two callback URLs; needed for login *and* Gmail sync |
| 9 | Two domains | your registrar | `app.` for frontend, `api.` for server |
| 10 | Sentry DSN | sentry.io | Optional but wanted before real users |

---

## 11. First-boot sequence

```bash
# 1. Create schemas and extensions (uuid-ossp, unaccent)
npx nx run searm-server:database:init:prod

# 2. Apply instance commands — including this fork's proposal, evidence,
#    fact, agentTask and agentRun tables
npx nx run searm-server:database:migrate:prod

# 3. Start server and worker as separate processes
npx nx start searm-server
npx nx run searm-server:worker
```

The worker is **not optional**. Without it, message sync, cron dispatch, and the agent-task queue never run — the CRM appears to work while the entire AI layer sits idle. Run it as its own always-on process.

Verify after boot:

```sql
SELECT tablename FROM pg_tables
WHERE schemaname = 'core'
  AND tablename IN ('proposal','proposalItem','evidence','fact','agentTask','agentRun');
-- expect 6 rows; fewer means an instance command did not register
```

That last check is not paranoia — this fork already shipped one migration that was never added to `INSTANCE_COMMANDS`, so its tables were silently never created while every test still passed.

---

## 12. First-run checklist — bare accounts to a working AI agent

Sections 1–11 tell you *what* the variables are. This is the ordered runbook that uses them, from two empty SaaS accounts to an instance where an agent can research a record and propose changes a human approves.

**Read this first.** No instance has ever been deployed against Neon and Upstash. Every step below is derived from code in this fork and from local runs on a Docker Postgres — the sequence is right, but you are the first person to run it against this stack, so treat unexpected output as new information rather than as your mistake. Budget half a day, not an hour.

Each step gives the action, **what to verify**, and **what failure looks like**. Do not proceed past a failed verification; on this project every skipped verification has cost more later than it saved.

### Step 1 — Neon project and the *direct* connection string

Create the project. Copy the **direct / unpooled** connection string (§1). Turn autosuspend off. Note your plan's connection cap.

- **Verify:** `psql "$PG_DATABASE_URL" -c 'select version()'` returns a Postgres 16+ banner.
- **Failure:** the host contains `-pooler` — you copied the pooled endpoint. It will connect fine here and fail much later with cryptic prepared-statement and schema-scoping errors that look like application bugs. Fix it now, not then.
- **Failure:** `SSL required` — append `?sslmode=require`.

### Step 2 — Redis: cache and queues

Create the Upstash database for `REDIS_URL`. Create a separate flat-priced Redis for `REDIS_QUEUE_URL` (§1 explains why; a 256 MB instance suffices).

- **Verify:** both URLs answer `PING` → `PONG` (`redis-cli --tls -u "$REDIS_URL" ping`).
- **Failure:** the scheme is `redis://` rather than `rediss://` for Upstash. The config validator accepts only `redis`/`rediss`, and Upstash requires TLS, so this surfaces as a boot-time validation error, not a connection error.
- **If you deliberately point both at Upstash:** set a calendar reminder for day 7 to read the command count. An idle BullMQ worker still polls continuously.

### Step 3 — Secrets and the env file

Generate `APP_SECRET` once (`openssl rand -base64 32`) and put it in a secret manager. Assemble the §3 core set plus at least one AI provider key from §4. Leave §7 messaging/calendar **off**.

- **Verify:** no placeholder values remain; `SIGN_IN_PREFILLED=false`; `IS_FDW_ENABLED` unset.
- **Failure:** an absent `ANTHROPIC_API_KEY` (or equivalent) is silent. The CRM will run perfectly and the entire AI layer will do nothing.

### Step 4 — Install dependencies and build

```bash
yarn install
cd packages/searm-server && rm -rf dist && npx nest build
```

- **Verify:** `ls node_modules/.bin | wc -l` returns several hundred (368 on a known-good install here). Then `npx tsgo -p tsconfig.json --noEmit`.
- **Failure — partial install:** hundreds of `TS2307: Cannot find module` errors, and no `node_modules/.bin` directory. This has happened on this project and was misdiagnosed as a dependency-injection bug for hours. `npx tsgo` 404ing against npm is the same symptom: the binary lives at `node_modules/@typescript/native-preview/bin/tsgo.js` and is normally reached through the missing `.bin`.
- **Failure — `EPERM ... unlink ... msgpackr-extract` (Windows):** a running node process, a stale `nest start`, or the Nx daemon holds the native module open. Stop them and re-run `yarn install`.
- **Note:** ten pre-existing implicit-`any` errors in graphql-yoga hooks and two Microsoft Graph drivers are inherited from upstream and are not yours. Anything beyond those ten is.
- **Always `rm -rf dist` first.** A `dist/` older than the source tree produces module-not-found errors at boot that look exactly like broken wiring.

### Step 5 — Create schemas and extensions

```bash
npx nx run searm-server:database:init:prod
```

- **Verify:** `select extname from pg_extension` includes `uuid-ossp` and `unaccent`; the `core` schema exists.
- **Failure:** `permission denied to create extension` — your Neon role lacks the grant. Both extensions are available on Neon; this is a role problem, not a platform one.

### Step 6 — Apply instance commands (this fork's tables)

```bash
npx nx run searm-server:database:migrate:prod
```

- **Verify** — this fork registers seven instance commands creating eight tables:

```sql
SELECT tablename FROM pg_tables
WHERE schemaname = 'core'
  AND tablename IN ('proposal','proposalItem','evidence','fact',
                    'agentTask','agentRun','importBatch','importRow');
-- expect 8 rows
```

- **Failure:** fewer than 8 rows means a migration file exists but was never added to `INSTANCE_COMMANDS`. That exact bug shipped here once and was invisible to every test, because the tests mock the repository. The registration list is `packages/searm-server/src/database/commands/upgrade-version-command/instance-commands.constant.ts`.

### Step 7 — Start the server

Run it, then check the log rather than the exit code.

- **Verify:** `curl -s $SERVER_URL/healthz` → `{"status":"ok","info":{},"error":{},"details":{}}`; the log contains `Nest application successfully started`; and `grep -cE "Nest can't resolve|UnknownDependenciesException" boot.log` returns **0**.
- **Failure — `Nest can't resolve dependencies of <Guard/Service>`:** a module is missing an import. This fork has broken boot twice this way, both times from a resolver whose auth guard needed `TokenModule` and `WorkspaceCacheStorageModule`. It is a whole-app failure, not a degraded feature: nothing starts.
- **Failure — `ECONNREFUSED` / retrying TypeORM:** the database is unreachable, not a wiring problem. Check step 1 before touching code.

### Step 8 — Start the worker as its own always-on process

```bash
npx nx run searm-server:worker
```

- **Verify:** the worker log shows queues attached, including `cron-queue` and `workspace-queue`.
- **Failure is silent and it is the worst one on this list.** Without the worker the CRM looks completely healthy: records save, the UI is fast, logins work. Message sync never runs, cron never fires, and no agent task is ever dispatched. If the AI layer "does nothing" and step 7 was clean, check here first.

### Step 9 — Register the agent-task dispatch cron

The research worker is driven by a cron job that must be registered once. It is not registered automatically.

```bash
node dist/command/command.js cron:ai-research:agent-task-dispatch
```

- **Verify:** the repeatable job exists on the cron queue (pattern `* * * * *`, i.e. every minute).
- **Failure is silent:** `AgentTask` rows are created and sit at `PENDING` forever. Nothing errors, nothing retries, no run appears. If tasks are created but no `agentRun` row ever shows up, this step was skipped.

### Step 10 — Create the first workspace and admin user

Sign up through the frontend (or create the workspace via your normal provisioning path).

- **Verify the research agent was seeded** — the standard-application sync emits it, and the whole research path depends on it:

```sql
SELECT name, "universalIdentifier" FROM core.agent WHERE name = 'researcher';
-- expect one row per workspace
SELECT label, "canBeAssignedToAgents" FROM core.role WHERE label = 'AI Researcher';
-- expect one row per workspace, canBeAssignedToAgents = true
```

- **Failure:** `resolveResearchAgentId` throws *"This workspace's research agent is not seeded. Re-run the standard application sync for workspace <id>."* — re-run the sync rather than creating the agent by hand.
- **Note:** the agent-to-role binding is made lazily on first use, not at seed time, because `roleTarget` is not part of the standard-metadata pipeline. The first research task in a workspace is therefore slower than the rest; that is expected, not a hang. If the seeded role has been deleted, the agent runs with **no registry tools** and the log says so — a tool-less run, not a crash.

### Step 11 — Confirm a model provider resolves

In Settings → AI, confirm both the "fast" and "smart" model slots resolve to a model your key covers (Anthropic alone is sufficient).

- **Verify:** open the AI chat and send one message; you get a reply.
- **Failure:** provider auth errors in the run log. Fix here, before involving the agent-task machinery, so a later failure is unambiguous.

### Step 12 — Prove the loop: research produces evidence and a proposal

**There is no UI for agent tasks.** Either ask the chat agent to research a record (it calls `create_agent_task`), or call the `createAgentTask` mutation directly against a person or company record.

- **Verify**, within about a minute of creating the task:

```sql
SELECT status, attempts, "leasedUntil" FROM core."agentTask" ORDER BY "createdAt" DESC LIMIT 1;
SELECT "inputTokens","outputTokens","creditsUsedMicro","elapsedMs"
  FROM core."agentRun" ORDER BY "createdAt" DESC LIMIT 1;
SELECT "sourceType","strength","payloadHash" FROM core.evidence ORDER BY "observedAt" DESC LIMIT 5;
SELECT "fieldName", value, status FROM core.fact ORDER BY "lastObservedAt" DESC LIMIT 5;
SELECT id, status, "sourceKey" FROM core.proposal WHERE status = 'PENDING';
```

Evidence rows before fact rows before a pending proposal is the chain working. A proposal with no evidence behind it is a bug worth stopping for.

- **Failure — task stuck at `PENDING`:** step 9.
- **Failure — task `LEASED` and never completing:** the worker is dispatching but the run is failing; read `core."agentRun"` for the error and elapsed time. A task that hit its step budget names the cap in its outcome rather than failing mysteriously.
- **Failure — run completes with no evidence:** the agent has no tools, which means the role binding in step 10 did not happen.

### Step 13 — Approve, and watch the record change exactly once

Go to **Settings → AI → Approvals**. You should see the pending proposal with a field-level diff and the citations behind each proposed value. Approve it.

- **Verify:** the target record now holds the proposed value; the `proposalItem` row reads `APPLIED`; the record's audit entry attributes the change to the approving user, not to the agent.
- **Failure:** the item lands in `failedItemIds` and the record is unchanged. There is a **known open defect** of exactly this shape for proposals whose payload writes a relation foreign key (for example `personId` on a `messageParticipant`), and the underlying error text is currently swallowed rather than returned. If you hit it on a plain scalar field, that is new and worth reporting.

### Step 14 — Accept that nobody will be told

There is no in-app notification when a proposal lands, and email is wired for authentication flows only. Whoever reviews proposals must visit Settings → AI → Approvals on a schedule. Decide that cadence now and tell the person; otherwise the queue grows silently and the product looks inert.

### Step 15 — Only then, consider messaging and calendar sync

Before enabling anything in §7, settle the privacy policy for ingested content reaching your LLM provider.

Understand what you get today: sync ingests mail and events, and participant identity matching creates traceable proposals — that part is real and tested. **Content extraction from message bodies and call recordings is not built.** Nothing is sent to a model from ingested content yet, and the per-account exclusion toggle that exists has nothing to exclude. Enable sync if you want participant matching; do not expect commitments, risks or next actions to be extracted.

### Standing operational checks for week one

| Check | Why |
| --- | --- |
| Upstash command count, daily | An idle BullMQ worker can generate millions of commands a month. Catch it on day 3, not on the invoice. |
| Neon connection count against your plan cap | `PG_POOL_MAX_CONNECTIONS` × every replica × server + worker. Exceeding it presents as intermittent failures, not a clean error. |
| `SELECT count(*) FROM core.proposal WHERE status = 'PENDING'` | Your only signal that the review queue is being worked. See step 14. |
| `SELECT sum("creditsUsedMicro") FROM core."agentRun"` grouped by day | Cost accounting is ours, not the provider's. Set per-task budgets deliberately. |
| `SELECT count(*) FROM core."agentTask" WHERE status='FAILED'` | Attempt exhaustion is recorded with a reason; a rising count means a systemic failure, not bad luck. |
