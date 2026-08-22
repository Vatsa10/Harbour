# Environment Variables — SeaRM Deployment

Everything below is verified against `packages/searm-server/src/engine/core-modules/searm-config/config-variables.ts`.

---

## 1. Minimum to boot

Without these, the server will not start.

```bash
PG_DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require
REDIS_URL=redis://localhost:6379
APP_SECRET=<32+ random bytes>
SERVER_URL=https://api.yourdomain.com
```

**Neon-specific notes:**
- Use the **direct (unpooled)** connection endpoint, not the pooled one. Pooled mode runs PgBouncer in transaction mode, which breaks prepared statements and per-workspace schema switching.
- Append `?sslmode=require` to the connection string.
- Turn autosuspend off — the background worker wakes it constantly anyway, and scale-to-zero cold starts add latency with zero benefit.

**Upstash-specific notes:**
- Use the `rediss://` scheme (double `s`) — Upstash requires TLS and the validator only accepts `redis` or `rediss` schemes.
- See section 4 below for the BullMQ cost trap with Upstash.

---

## 2. Multi-tenant SaaS

Only needed if you host multiple tenants on one instance.

```bash
IS_MULTIWORKSPACE_ENABLED=true
IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS=true
FRONTEND_URL=https://app.yourdomain.com
DEFAULT_SUBDOMAIN=app
```

**Important:** Wildcard DNS (e.g., `*.yourdomain.com`) is required for subdomain-based tenant routing. Per-tenant custom domains no longer exist (that was a Cloudflare feature we removed).

---

## 3. AI

Required for the research agent, evidence extraction, and any proposal generation.

```bash
ANTHROPIC_API_KEY=
# and/or
OPENAI_API_KEY=
GOOGLE_API_KEY=
XAI_API_KEY=
MISTRAL_API_KEY=
```

At least one provider is required. Anthropic alone is sufficient.

Optional: specify default models per workspace:
```bash
AI_MODELS_DEFAULT_FAST=openai/gpt-4o-mini,anthropic/claude-haiku-4-5-20251001
AI_MODELS_DEFAULT_SMART=openai/gpt-4,anthropic/claude-opus-4-1
AI_MODELS_DEFAULT_RECOMMENDED=openai/gpt-4,anthropic/claude-opus-4-1
```

---

## 4. Production-practical

### Email (required for verification, invitations, password reset, and the only notification channel)

```bash
EMAIL_DRIVER=smtp
EMAIL_FROM_ADDRESS=noreply@yourdomain.com
EMAIL_FROM_NAME=SeaRM
EMAIL_SMTP_HOST=smtp.example.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_USER=
EMAIL_SMTP_PASSWORD=
```

If `EMAIL_DRIVER` is not `smtp`, leave the SMTP fields unset.

### Storage (required for production; local storage breaks with container restarts or multiple replicas)

```bash
STORAGE_TYPE=s3
STORAGE_S3_REGION=us-east-1
STORAGE_S3_NAME=bucket-name
STORAGE_S3_ENDPOINT=                    # omit for native AWS; set for R2/MinIO/Backblaze
STORAGE_S3_ACCESS_KEY_ID=               # omit to use IAM role/instance profile
STORAGE_S3_SECRET_ACCESS_KEY=           # required if ACCESS_KEY_ID is set
```

Local storage (`STORAGE_TYPE=local`) works for single-instance dev only.

### Redis for queues (separate from cache to avoid Upstash costs)

```bash
REDIS_QUEUE_URL=redis://localhost:6380
```

See section 4 below if using Upstash — you need a separate flat-rate Redis for BullMQ.

### Authentication

At least one method must be enabled:

```bash
AUTH_PASSWORD_ENABLED=true
IS_EMAIL_VERIFICATION_REQUIRED=true

# Google (also required for Gmail/Calendar sync)
AUTH_GOOGLE_ENABLED=false
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
```

---

## 5. Optional

### Messaging and calendar sync (Phase 3)

```bash
MESSAGING_PROVIDER_GMAIL_ENABLED=false
CALENDAR_PROVIDER_GOOGLE_ENABLED=false
MESSAGING_PROVIDER_MICROSOFT_ENABLED=false
CALENDAR_PROVIDER_MICROSOFT_ENABLED=false
IS_IMAP_SMTP_CALDAV_ENABLED=false
```

Leave these off until Phase 3 is complete and reviewed. When enabled, ingested content is sent to your configured LLM provider for extraction.

### Observability

```bash
LOG_LEVELS=error,warn
LOGGER_DRIVER=CONSOLE
EXCEPTION_HANDLER_DRIVER=console
SENTRY_DSN=                 # if EXCEPTION_HANDLER_DRIVER=sentry
SENTRY_FRONT_DSN=           # if EXCEPTION_HANDLER_DRIVER=sentry
SENTRY_ENVIRONMENT=production
TELEMETRY_ENABLED=true
ANALYTICS_ENABLED=false
CLICKHOUSE_URL=             # only if ANALYTICS_ENABLED=true
```

### Security and advanced

```bash
SIGN_IN_PREFILLED=false                           # MUST be false in production
IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS=true
OUTBOUND_HTTP_SAFE_MODE_ENABLED=true
IS_EMAIL_VERIFICATION_REQUIRED=true
PG_SSL_ALLOW_SELF_SIGNED=false
```

### Support chat

```bash
SUPPORT_DRIVER=none                 # or 'front' if using Front.com
SUPPORT_FRONT_CHAT_ID=              # required if SUPPORT_DRIVER=front
SUPPORT_FRONT_HMAC_KEY=             # required if SUPPORT_DRIVER=front
```

### CAPTCHA

```bash
CAPTCHA_DRIVER=                     # e.g., 'GOOGLE_RECAPTCHA'
CAPTCHA_SITE_KEY=
CAPTCHA_SECRET_KEY=
```

### Workspace behavior

```bash
WORKSPACE_SCHEMA_DDL_LOCKED=false
IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS=true
IS_FEATURE_FLAG_MANAGEMENT_ENABLED=false
```

---

## 6. Infrastructure sizing notes

### Upstash + BullMQ cost trap

SeaRM uses BullMQ for every background job (message sync, calendar sync, cron, agent tasks). BullMQ workers hold blocking Redis connections and poll continuously.

Upstash bills per command. An idle BullMQ worker generates millions of commands a month.

**Solution:** Use `REDIS_QUEUE_URL` to split cache from queues:

| Variable | Point it at | Why |
| --- | --- | --- |
| `REDIS_URL` | Upstash | Cache and sessions — request-shaped traffic |
| `REDIS_QUEUE_URL` | Dedicated flat-rate Redis | BullMQ — connection-shaped traffic, priced per month not per command |

For the queue Redis, use Railway, Fly.io, DigitalOcean Managed Redis, or Redis Cloud's fixed tier. A 256 MB instance is sufficient.

### Local development notes

Local dev runs Postgres on port **5433** and Redis on port **6380**:

```bash
PG_DATABASE_URL=postgres://postgres:postgres@localhost:5433/default
REDIS_URL=redis://localhost:6380
```

---

## 7. All configuration variables

The complete reference is in `packages/searm-server/src/engine/core-modules/searm-config/config-variables.ts`. Every variable above exists in that file and is verified to be actively used (billing-related and Cloudflare-related variables have been removed).

### Verification checklist

Before deploying:

- [ ] `PG_DATABASE_URL` uses the **direct** endpoint (not pooled) with `?sslmode=require`
- [ ] `REDIS_URL` and `REDIS_QUEUE_URL` are distinct (if using Upstash, only `REDIS_URL` points to Upstash)
- [ ] `APP_SECRET` is 32+ bytes, generated once, and stored in a secret manager
- [ ] `SIGN_IN_PREFILLED=false` in production
- [ ] At least one AI provider key is set
- [ ] Email is configured if verification or invitations are enabled
- [ ] Storage is `s3` (not `local`) in production
- [ ] `SERVER_URL` and `FRONTEND_URL` match your actual domains
