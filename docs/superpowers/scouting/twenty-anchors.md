# Twenty Codebase Anchors — Scouting Report

Base commit context: this scout was run against the `twenty` checkout at
`d:/Files/Vatsa/Projects/AI-CRM/twenty` (no git metadata present in this
checkout, so no SHA could be confirmed — verify against `6e1c710` before
citing this report as canonical). All paths below are relative to
`d:/Files/Vatsa/Projects/AI-CRM/twenty/packages/` unless stated otherwise.
Every claim in this report was verified by opening the file — nothing here
is inferred from directory names alone, except where explicitly flagged
"not opened, name suggests X — verify before relying on it."

**Headline finding: Twenty is dramatically further along the charter's
trust layer than the charter's own wording ("it has AgentRun, turns, and
cost accounting today") suggests.** It already has a `ProposalEntity` /
`ProposalItemEntity` pair, an MCP server, a durable per-workspace job
system, a full installable-application framework with agents/roles/skills,
and a working spreadsheet import pipeline. The four plans should extend
these, not re-invent them. Sections below are ordered per the task's 7
areas; a dedicated section 8 maps directly onto the charter's six trust
entities and five contracts.

---

## 1. AI and Agents — `engine/metadata-modules/ai/`

Ten sibling modules live under
`twenty-server/src/engine/metadata-modules/ai/`:
`ai-agent`, `ai-agent-execution`, `ai-agent-monitor`, `ai-agent-role`,
`ai-billing`, `ai-chat`, `ai-generate-text`, `ai-models`,
`ai-workspace-stats`, **`ai-write-approval`** (the last one is the
proposal/approval system and directly implements the charter's `Proposal`
and `ProposalItem` entities — see §8).

### ai-agent — the agent definition

`ai-agent/entities/agent.entity.ts` — `AgentEntity` (table `agent`,
extends `SyncableEntity`):

```ts
@Entity('agent')
export class AgentEntity extends SyncableEntity implements Required<AgentEntity> {
  id: string;                                  // uuid PK
  name: string;                                // unique per (name, workspaceId) where deletedAt IS NULL
  label: string;
  icon: string | null;
  description: string | null;
  prompt: string;                              // system prompt, required text
  modelId: ModelId;                            // default AUTO_SELECT_SMART_MODEL_ID
  responseFormat: JsonbProperty<AgentResponseFormat> | null; // default { type: 'text' }
  isCustom: boolean;
  modelConfiguration: JsonbProperty<ModelConfiguration> | null;
  evaluationInputs: string[];                  // for ai-agent-monitor
  createdAt / updatedAt / deletedAt: Date;
}
```

This is a durable, named, prompt-configured agent definition — exactly
what a "research agent" would need as its config row. **A durable research
agent should be a new `AgentEntity` row (or a new `agentType`/role
distinction on it), not a parallel "ResearchAgent" entity.**

`ai-agent-role/` — links agents to permission roles (entities + services
under `ai-agent-role`, confirms agents already have a role/permission
binding point to extend for scoped tool access — verify exact shape
before the plan assumes a specific method name).

### ai-agent-execution — runs, turns, messages

Three entities under `ai-agent-execution/entities/`, all workspace-scoped
(`workspaceId` column + FK to `WorkspaceEntity`, `schema: 'core'`):

- `AgentTurnEntity` (table `agentTurn`): `id`, `workspaceId`, `threadId`
  (FK → `AgentChatThreadEntity`), `agentId`, `messages: AgentMessageEntity[]`,
  `evaluations: AgentTurnEvaluationEntity[]`, `createdAt`. **This is the
  closest existing analog to the charter's `AgentRun`** — one turn = one
  agent execution cycle within a chat thread.
- `AgentMessageEntity` (table `agentMessage`): `id`, `workspaceId`,
  `threadId`, `turnId` (nullable FK → `AgentTurnEntity`), `agentId`,
  `role: AgentMessageRole` (`system|user|assistant`), `status:
  AgentMessageStatus` (`queued|sent`), `parts:
  AgentMessagePartEntity[]`, `isHidden`, `processedAt`, `createdAt`.
- `AgentMessagePartEntity` — holds the AI-SDK message parts
  (text/tool-call/tool-result chunks per message); referenced from
  `AgentMessageEntity` as a `OneToMany` (not opened directly).

`AgentChatThreadEntity` lives in `ai-chat/entities/agent-chat-thread.entity.ts`
(not opened; owns both turns and messages, is the conversation container).

**What this means for the charter's `AgentRun`/`AgentTask`:** Twenty has
the *turn/message/thread* shape of a chat-driven agent execution, but
**does not have** anything resembling `AgentTask` (durable, leased,
retryable, budgeted, cancellable scheduled work) or a standalone
`AgentRun` with model/provider, elapsed time, and structured error detail
independent of a chat thread. `AgentTurnEntity` is chat-shaped (always
hangs off a `threadId`), not task-shaped (no lease, no retry count, no
priority, no idempotency key, no cancellation flag, no explicit
status enum was found on the turn itself). **A durable research agent
needs a new `AgentTask` + `AgentRun` pair that can exist without a chat
thread** — extend the turn/message pattern for transcript storage, but
build the scheduling/lease/retry/budget envelope fresh (see §3 for the
existing job-queue primitives to build it on top of, and §8 for the exact
gap against the charter's contract).

`ai-agent-execution/services/` and `/resolvers/` were listed but not
opened line-by-line in this pass — they contain the async executor that
turns a message into a turn+response and streams it back; before writing
the research-agent plan, read `ai-agent-execution/services/*.ts` directly
to get the executor's exact method signature and actor-context plumbing
(this scout ran out of budget to open every file; treat the async-executor
internals as **unverified, verify before citing signatures**).

### ai-agent-monitor — turn evaluation

`ai-agent-monitor/entities/agent-turn-evaluation.entity.ts` —
`AgentTurnEvaluationEntity`, linked `ManyToOne` from `AgentTurnEntity`.
Combined with `AgentEntity.evaluationInputs: string[]`, this is an
existing eval/scoring harness for agent turns (jobs under
`ai-agent-monitor/jobs/` run evaluations asynchronously). Not opened in
depth; flag for the agent-monitor plan author to read directly.

### ai-billing — cost accounting

`ai-billing/services/ai-billing.service.ts` — `AiBillingService`, read in
full:

```ts
calculateCost(modelId: ModelId, billingInput: BillingUsageInput): number
async calculateAndBillUsage(modelId, billingInput, workspaceId, operationType: UsageOperationType, agentId?, userWorkspaceId?): Promise<void>
async decrementAndCheckAvailableCredits(modelId, billingInput, workspaceId): Promise<{ hasNoMoreAvailableCredits: boolean }>
async billNativeWebSearchUsage(nativeWebSearchCallCount, workspaceId, userWorkspaceId?): Promise<void>
async emitAiTokenUsageEvent(workspaceId, creditsUsedMicro, totalTokens, modelId, operationType, agentId?, userWorkspaceId?): Promise<void>
```

`BillingUsageInput = { usage: LanguageModelUsage; cacheCreationTokens?: number }`
(`LanguageModelUsage` is the Vercel AI SDK's token-usage shape:
`inputTokens`, `outputTokens`, `inputTokenDetails.cacheReadTokens`,
`outputTokenDetails.reasoningTokens`).

Cost math flows through `computeCostBreakdown` (util,
`ai-billing/utils/compute-cost-breakdown.util.ts`) and
`convertDollarsToBillingCredits`, then emits a workspace-scoped
`USAGE_RECORDED` event via `WorkspaceEventEmitter.emitCustomBatchEvent`
carrying a `UsageEvent` (`resourceType: AI`, `operationType`,
`creditsUsedMicro`, `quantity`, `unit`, `resourceId` (used for `agentId`),
`resourceContext` (model id), `userWorkspaceId`, `periodStart`). This is a
**complete, working per-workspace AI cost-accounting pipeline already
wired to `BillingUsageService`/`BillingService`** — a research agent's
run-cost tracking should call `AiBillingService.calculateAndBillUsage`
per model call, not build new cost math.

### ai-chat

`ai-chat/entities/agent-chat-thread.entity.ts` (owner of turns/messages,
not opened in depth), `ai-chat/tools/` (chat-specific tool wiring),
`ai-chat/jobs/` (async processing of chat turns — likely where the BullMQ
job that drives the agent executor lives; **verify job name before the
async-executor plan cites it**).

---

## 2. Tools and MCP

### Tool registration — `core-modules/tool/` and `core-modules/tool-provider/`

Two directories, distinct responsibilities:

- `core-modules/tool/` — a handful of **concrete tool implementations**
  (`calendar-tool`, `code-interpreter-tool`, `email-tool`, `http-tool`,
  `navigate-tool`, `output-navigation-tool`, `search-help-center-tool`,
  `send-email-tool`) plus shared types:
  - `tool/types/tool-output.type.ts` — **the canonical `ToolOutput<T>`
    shape**, read in full:
    ```ts
    export type ToolOutput<T = object> = {
      success: boolean;
      message: string;
      error?: string;
      result?: T;
      warnings?: string[];
      status?: number;
      statusText?: string;
      headers?: Record<string, string>;
      recordReferences?: RecordReference[];
    };
    ```
    Every tool implementation returns this. `RecordReference` is defined
    in `tool/types/record-reference.type.ts` (not opened; used to let a
    tool point back at CRM records it touched).
  - `tool/types/tool-execution-context.type.ts`,
    `tool/types/tool-input.type.ts`, `tool/types/tool.type.ts` — the
    remaining shared tool contracts (not opened line-by-line; read before
    building a new tool).
  - `tool/services/tool-output-spill.service.ts` — handles large tool
    outputs (spills to storage rather than inlining, based on the name;
    verify).

- `core-modules/tool-provider/` — the **registry and dynamic tool
  generation** layer. Key contract, `tool-provider/interfaces/tool-provider.interface.ts`,
  read in full:
  ```ts
  export interface ToolProvider {
    readonly category: ToolCategory;
    isAvailable(context: ToolProviderContext): Promise<boolean>;
    generateDescriptors(
      context: ToolProviderContext,
      options?: GenerateDescriptorOptions,
    ): Promise<(ToolIndexEntry | ToolDescriptor)[]>;
    executeStaticTool(
      toolName: string,
      args: Record<string, unknown>,
      context: ToolProviderContext,
    ): Promise<ToolOutput>;
  }
  ```
  **This is the extension point for a new tool category** (e.g. a
  "research" or "evidence" tool provider). Existing providers under
  `tool-provider/providers/`: `action-tool.provider.ts`,
  `dashboard-tool.provider.ts`, `database-tool.provider.ts` (generic CRUD
  over any workspace object — this is almost certainly how
  metadata-aware record read/write tools are already generated, one per
  object, dynamically from metadata — **read this file before designing
  the Proposal-creation tool**, it is the closest existing pattern),
  `logic-function-tool.provider.ts`, `metadata-tool.provider.ts`,
  `navigation-menu-item-tool.provider.ts`, `role-tool.provider.ts`,
  `view-tool.provider.ts`, `webhook-tool.provider.ts`,
  `workflow-tool.provider.ts`.

  `tool-provider/types/tool-descriptor.type.ts`:
  ```ts
  export type ToolDescriptor = ToolIndexEntry & { inputSchema: object };
  ```
  `ToolIndexEntry` (not opened; the lighter-weight "tool exists, here's
  its name/description" record used before the full schema is loaded —
  this is the same deferred-tool-loading pattern visible in this
  conversation's own tool list).

  `tool-provider/services/tool-registry.service.ts` and
  `tool-executor.service.ts` — the runtime registry and dispatcher (not
  opened; `tool-provider/constants/tool-providers.token.ts` is the DI
  token providers register against — **this is how a new tool provider
  gets wired in**: implement `ToolProvider`, register it against the
  `TOOL_PROVIDERS` token, likely via a NestJS multi-provider array in
  `tool-provider.module.ts`. Confirm exact DI wiring by reading
  `tool-provider.module.ts` before the MCP/tools plan assumes a specific
  registration call.)

  `tool-provider/tools/` holds meta-tools: `execute-tool.tool.ts`,
  `get-tool-catalog.tool.ts`, `learn-tools.tool.ts`, `load-skill.tool.ts`
  — i.e. Twenty already implements a **progressive tool-disclosure
  pattern** (catalog → learn → execute) rather than dumping every tool
  schema into every prompt. A research agent or MCP client extension
  should plug into this catalog/learn/execute flow, not bypass it.

### MCP — `engine/api/mcp/`

- `mcp.module.ts` wires the module (not opened in depth).
- **Auth**: `mcp/guards/mcp-auth.guard.ts`, read in full. `McpAuthGuard`
  wraps the existing `JwtAuthGuard`; on 401 it sets an RFC 9728-compliant
  `WWW-Authenticate: Bearer resource_metadata="<base>/.well-known/oauth-protected-resource/mcp", scope="<ALL_OAUTH_SCOPES joined>"`
  header before throwing `UnauthorizedException`. `ALL_OAUTH_SCOPES` comes
  from `application/application-oauth/constants/oauth-scopes.ts`. **MCP
  auth today is OAuth-bearer via the existing JWT guard plus standard
  protected-resource discovery — this already satisfies the charter's
  "OAuth-scoped agent credentials with workspace-limited access"
  requirement at the transport layer**; what remains is scoping which
  tools/records an OAuth grant can reach (tie into `application-oauth`
  scopes, not a new auth mechanism).
- **Protocol / tool exposure**: `mcp/services/mcp-protocol.service.ts`
  (JSON-RPC framing, not opened in depth — read before citing exact
  method names), `mcp/services/mcp-tool-executor.service.ts`, read in
  full. Key methods:
  ```ts
  class McpToolExecutorService {
    async handleToolCall(id: string | number, toolSet: ToolSet, params: Record<string, unknown>, sseWriter?: (data) => void)
    handleToolsListing(id: string | number, toolSet: ToolSet)
  }
  ```
  `toolSet: ToolSet` is the Vercel AI SDK's `ToolSet` — i.e. **the same
  tool objects used for LLM tool-calling are directly re-exposed over
  MCP**, there is exactly one tool implementation surface for both
  internal-agent and external-MCP-client use. This is the single most
  important fact for the MCP/tools plan: **do not build separate MCP tool
  definitions — register through `ToolProvider`/`ToolIndexEntry` and both
  internal agents and MCP clients pick it up.**
- **Error shape returned to a model today**: on success,
  `{ content: [{ type: 'text', text: JSON.stringify(result) }], isError: false }`
  where `result` is a `ToolOutput`. On thrown exception,
  `{ content: [{ type: 'text', text: error.message }], isError: true }`.
  **This is materially short of the charter's required
  `{ code, message, hint, allowed_actions, retryable }` machine-readable
  failure shape** — today a failure is just a JSON-stringified
  `ToolOutput` (which has `success`/`error`/`message`/`warnings` but no
  `code`, `hint`, `allowed_actions`, or `retryable`) or a bare exception
  message string with no structure at all. **Gap: the plan must add the
  four charter-required fields to `ToolOutput` (or a new `ToolFailure`
  type) and thread them through `McpToolExecutorService.handleToolCall`'s
  catch branch** — this is a small, well-localized change, not new
  machinery.
- `mcp/constants/mcp-excluded-tool-names.const.ts`,
  `mcp-closed-world-read-only-tool-annotations.const.ts`,
  `mcp-open-world-read-only-tool-annotations.const.ts`,
  `mcp-execute-tool-annotations.const.ts` — Twenty already tags tools with
  MCP annotations (read-only/open-world/etc.) and can exclude specific
  tools from MCP exposure. Any new "propose write" tool should get a
  `destructiveHint`/non-read-only annotation here, and any raw-write CRUD
  tool that must never reach an external MCP client belongs in
  `mcp-excluded-tool-names.const.ts`.
- `mcp/controllers/mcp-core.controller.ts` — the HTTP entrypoint (SSE +
  JSON-RPC, given `write-sse-event.util.ts`).

---

## 3. Background work — message-queue (BullMQ), cron, workspace-scoped jobs

`core-modules/message-queue/` wraps BullMQ behind an interface-driven
module (`drivers/bullmq.driver.ts` for real use, `drivers/sync.driver.ts`
for tests). Registration decorators:
`decorators/message-queue.decorator.ts` (`@InjectMessageQueue(queueName)`),
`decorators/process.decorator.ts` (`@Process(jobName)`),
`decorators/processor.decorator.ts` (`@Processor(queueNameOrOptions)`).
`message-queue.constants.ts` defines the `MessageQueue` enum of named
queues (e.g. `cronQueue`, `messagingQueue`). `MessageQueueService` is the
injected service with `.add<T>(jobName, data)`.

**End-to-end real example — verified by reading both files** (email
sync), the canonical pattern to imitate for a durable, retryable,
per-workspace research task:

1. **Cron fan-out job** —
   `modules/messaging/message-import-manager/crons/jobs/messaging-message-list-fetch.cron.job.ts`:
   ```ts
   export const MESSAGING_MESSAGE_LIST_FETCH_CRON_PATTERN = '2-59/5 * * * *';

   @Processor(MessageQueue.cronQueue)
   export class MessagingMessageListFetchCronJob {
     constructor(
       @InjectRepository(WorkspaceEntity) private workspaceRepository: Repository<WorkspaceEntity>,
       @InjectMessageQueue(MessageQueue.messagingQueue) private messageQueueService: MessageQueueService,
       @InjectRepository(MessageChannelEntity) private messageChannelRepository: Repository<MessageChannelEntity>,
       private exceptionHandlerService: ExceptionHandlerService,
     ) {}

     @Process(MessagingMessageListFetchCronJob.name)
     @SentryCronMonitor(MessagingMessageListFetchCronJob.name, MESSAGING_MESSAGE_LIST_FETCH_CRON_PATTERN)
     async handle(): Promise<void> {
       // 1. iterate ACTIVE workspaces only
       // 2. per workspace, find channels in a "pending" sync stage, filtered by isThrottled()/staleness
       // 3. atomically claim them: UPDATE ... SET syncStage = SCHEDULED WHERE syncStage = PENDING RETURNING id
       //    (this is the lease/claim pattern — avoids double-scheduling under concurrent cron ticks)
       // 4. for each claimed id, messageQueueService.add(JobClass.name, { workspaceId, messageChannelId })
       // 5. per-workspace try/catch reports to ExceptionHandlerService without killing the whole cron tick
     }
   }
   ```
   The claim step uses a raw `createQueryBuilder().update().set(...).where(...).returning('id')` conditioned
   on the *current* stage — a compare-and-swap that is the de facto
   lease/idempotency mechanism Twenty already uses for scheduling durable
   per-workspace work. **This is the pattern an `AgentTask` claim/lease
   operation should copy.**

2. **Workspace-scoped worker job** —
   `modules/messaging/message-import-manager/jobs/messaging-messages-import.job.ts`:
   ```ts
   export type MessagingMessagesImportJobData = { messageChannelId: string; workspaceId: string };

   @Processor({ queueName: MessageQueue.messagingQueue, scope: Scope.REQUEST })
   export class MessagingMessagesImportJob {
     constructor(
       private messagingMessagesImportService: MessagingMessagesImportService,
       private messagingMonitoringService: MessagingMonitoringService,
       private globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
       @InjectRepository(MessageChannelEntity) private messageChannelRepository: Repository<MessageChannelEntity>,
     ) {}

     @Process(MessagingMessagesImportJob.name)
     async handle(data: MessagingMessagesImportJobData): Promise<void> {
       const authContext = buildSystemAuthContext(data.workspaceId);
       await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
         // re-fetch and re-validate state before doing work (defends against stale/duplicate job execution)
         // only proceeds if syncStage still equals the expected "scheduled" value
         await this.messagingMessagesImportService.processMessageBatchImport(...);
       });
     }
   }
   ```
   Two things worth copying directly: `Scope.REQUEST` processors get a
   fresh DI graph per job (safe for per-workspace DB context), and
   `GlobalWorkspaceOrmManager.executeInWorkspaceContext(fn)` +
   `buildSystemAuthContext(workspaceId)` is **the standard way to run
   workspace-scoped ORM operations from inside a queue worker outside any
   HTTP request** — this is exactly what an `AgentTask` worker executing
   a research run needs.

Cron registration itself: `SentryCronMonitor` decorator
(`core-modules/cron/sentry-cron-monitor.decorator.ts`) wraps the handler
for observability; commands under `crons/commands/*.cron.command.ts`
(e.g. `messaging-message-list-fetch.cron.command.ts`) are Nest-commander
CLI commands presumably invoked by an external scheduler/entrypoint
(k8s CronJob or similar); **the exact cron-registration entrypoint was
not opened in this pass — confirm before the background-work plan states
"add a `@Cron()` decorator", since this codebase's convention is clearly
command+queue-based, not raw `@Cron()` annotations** (a full-repo grep for
`@Cron(` returned only one incidental hit in `database-config.driver.ts`,
confirming `@Cron()` is *not* the idiomatic pattern here — always follow
the cron-command + BullMQ-cronQueue pattern shown above).

Retention/backoff config:
`message-queue/constants/queue-retention.constants.ts` (not opened; check
for existing retry/backoff defaults before inventing new ones for
`AgentTask`).

---

## 4. Ingestion — messaging, calendar, connected-account, contact-creation, match-participant

`modules/messaging/` structure (verified via directory listing):
`blocklist-manager`, `message-cleaner`, `message-folder-manager`
(per-provider drivers: gmail/imap/microsoft), `message-import-manager`
(cron+job pair from §3, plus per-provider drivers including
`inbound-email` and `smtp`), `message-outbound-manager` (send path),
`message-participant-manager` (jobs + listeners — this is where inbound
messages get their participants resolved to workspace records),
`monitoring` (its own crons/jobs for stale-sync detection).

`modules/contact-creation-manager/` — turns message/event participants
into Person/Company records. Files confirm a full utility pipeline:
`create-company-and-contact.service.ts`, `create-company.service.ts`,
`create-person.service.ts`, plus parsing utilities
(`get-parsed-name-from-display-name.util.ts`,
`get-parsed-name-from-email-local-part.util.ts`,
`get-company-name-from-domain-name.util.ts`,
`get-domain-name-from-handle.util.ts`,
`extract-domain-from-link.util.ts`) and dedupe guards
(`filter-out-contacts-that-belong-to-self-or-workspace-members.util.ts`,
`has-primary-email-changed.ts`,
`compute-changed-additional-emails.ts`). There's a dedicated job,
`jobs/create-company-and-contact.job.ts`, meaning this already runs
async/queued, not inline. **This is the existing deterministic
email/domain-matching dedupe machinery the charter's "Lead to qualified
opportunity" workflow step 2 requires — extend it, don't reimplement
matching logic.**

`modules/match-participant/` — `match-participant.service.ts` +
`find-person-by-primary-or-additional-email.ts` +
`add-person-email-filters-to-query-builder.ts`. This is the identity
resolution step that decides whether an inbound message participant maps
to an existing Person record (checks both primary and additional emails).
**This is Twenty's existing identity-matching primitive** — the charter's
`crm`-sourced "identity resolution" capability should extend this
service's query pattern (person lookup by primary/additional email) as
its base case, adding company-domain and cross-record heuristics on top
rather than writing a new matcher from scratch.

**Where extracted structured data would hook in**: the natural seam is
downstream of `message-participant-manager` (participants resolved) and
`contact-creation-manager` (records exist), and upstream of/alongside
`messaging-messages-import.job.ts`'s per-batch processing — i.e. a new
job in the same queue (`MessageQueue.messagingQueue` or a dedicated
`researchQueue`) that runs after a message batch is imported, reads the
now-persisted `Message`/`CalendarEvent` records plus their resolved
participants, and emits `Evidence` rows (charter entity) rather than
writing directly to Person/Opportunity fields. `modules/calendar/` mirrors
`modules/messaging/`'s structure (confirmed present via the
`calendar-event-import-manager` path in §5) — same extension seam applies
for meeting data.

---

## 5. Import — spreadsheet/CSV path

**Frontend**: two related directories —
`twenty-front/src/modules/object-record/spreadsheet-import/` (the
generic, object-aware import UI: field mapping, validation, preview) and
`twenty-front/src/modules/spreadsheet-import/` (lower-level spreadsheet
parsing/mapping component library it's built on — this looks like the
vendored/adapted `react-spreadsheet-import` library). A third,
`twenty-front/src/modules/onboarding/components/import-contacts/`, is the
onboarding-flow's thin wrapper around the same machinery for first-run CSV
contact import.

**Backend**: no server-side directory named `*import*` exists for generic
record import in this pass's search (the only backend `*import*` hits
were `calendar-event-import-manager` and the messaging import manager,
both ingestion pipelines, not the spreadsheet importer). This strongly
suggests **today's spreadsheet import is front-end-driven**: the UI parses
and validates the file client-side, maps columns to fields, and then
writes records through the ordinary GraphQL record-creation mutations —
i.e. it rides the same object/field/permission path as manual record
creation, with no dedicated resumable/idempotent backend import job.
**This is a real gap against the charter's "Data import and quality"
workflow**, which requires "a resumable idempotent job" that imports rows
server-side with "failed rows stay downloadable and retryable." Before
finalizing the import plan, grep `twenty-server/src` for `spreadsheet` and
for the GraphQL mutations the front-end import calls, to confirm there is
no hidden batch-import resolver — this scout did not find one but did not
exhaustively search resolvers either. **Field mapping, validation, and
column-inference UI today live entirely in
`twenty-front/src/modules/spreadsheet-import` and
`object-record/spreadsheet-import`; failure handling is whatever that
client-side flow does today (likely: show errors, let the user retry the
whole file) — there is no server-side partial-failure/resume state
machine to extend, so the import plan should expect to build the
resumable-job half fresh, using the §3 cron+queue pattern as its
foundation, while reusing the front-end's mapping/validation UI and
component library.**

---

## 6. Applications / extensibility

This is far more built-out than a typical "app store stub" — verified by
directory structure and one real fixture app.

### What an application can define today

From `packages/twenty-apps/fixtures/rich-app/src/` (a real, working test
fixture) and the corresponding
`application-manifest/converters/from-*-manifest-to-universal-flat-*.util.ts`
files (each converter name is a manifest capability), an application can
define, one file per unit, auto-discovered by folder/suffix convention:

- **Objects & fields**: `objects/*.object.ts`, `fields/*.field.ts`
  (including relation fields defined from both sides, e.g.
  `post-card-recipients-on-post-card.field.ts` /
  `recipient-on-post-card-recipient.field.ts`), `indexes/*.index.ts`.
- **Views**: `views/*.view.ts`, `viewFields/*-view-field.ts`,
  `view-field-group`, `view-filter`, `view-filter-group`, `view-sort` (all
  have converters).
- **Navigation & layout**: `navigation-menu-items/*.navigation-menu-item.ts`,
  `page-layout-tabs/*.page-layout-tab.ts`, `page-layout-widget` (converter
  exists), `command-menu-item` (converter exists).
- **Permissions**: `roles/*.role.ts`, plus converters for
  `field-permission`, `object-permission`, `permission-flag`,
  `row-level-permission-predicate(-group)` — i.e. **row-level and
  field-level permission definitions are already app-manifest-expressible**,
  not just object/field CRUD permission.
- **Logic**: `logic-functions/*.function.ts` (serverless functions, e.g.
  `on-post-card-created.function.ts` — an event-triggered function,
  `enrich-post-cards.function.ts`, `lookup-recipient.function.ts`).
- **Front-end**: `components/*.front-component.tsx`,
  `root.front-component.tsx` — apps can ship actual React UI, sandboxed
  and rendered by `twenty-sdk`'s `front-component-renderer`.
- **Agents & skills**: confirmed in
  `packages/twenty-apps/examples/hello-world/src/agents/example-agent.ts`
  and `src/skills/example-skill.ts`, and a converter
  `from-agent-manifest-to-universal-flat-role-target.util.ts` and
  `from-skill-manifest-to-universal-flat-skill.util.ts` exist. **Apps can
  already declare agents and skills as part of their manifest** — this
  directly satisfies the charter Phase 5 exit gate's "agent instructions"
  requirement; a vertical app's agent policy/prompt should be defined the
  same way `hello-world`'s example agent is, not via a new mechanism.
- **Connections**: `connection-provider` converter exists — apps can
  declare OAuth/external-connection provider definitions (this is the
  mechanism the public apps under `twenty-apps/public/` — `slack`,
  `discord`, `linear`, `people-data-labs`, `exa`, `call-recorder`,
  `fireflies`, `last-contact` — use to define their external
  integrations).
- **Variables**: `application-variable` / `application-registration-variable`
  — app-scoped config values (API keys, settings) with dedicated
  entities/DTOs.
- No `*.workflow.ts` unit or workflow converter was found in this pass —
  **workflows do not currently appear to be app-manifest-definable**,
  only logic-functions and agents are. Confirm with a targeted grep for
  `workflow` under `application-manifest/converters` before the
  vertical-apps plan assumes workflow templates ship inside an app
  manifest; today they likely need to be seeded via a different mechanism
  (seed data / install-time job) rather than the declarative manifest
  units above.
- **Seed data**: not directly confirmed as its own manifest unit in this
  pass; `application-key-value` (entities/services/enums found under
  `application/application-key-value/`) may be the persistence layer for
  app-scoped seed/config data — verify before the vertical-apps plan
  states seed data has no home.

### Install/upgrade/uninstall lifecycle

Confirmed present as first-class, separately-moduled operations:

- **Install**: `application-install/application-install.service.ts` +
  `.resolver.ts` + `commands/install-application.command.ts` (CLI-drivable)
  + `utils/build-application-file-list.util.ts` +
  `utils/should-refresh-application-registration-on-install.util.ts`.
- **Upgrade**: `application-upgrade/application-upgrade.service.ts` +
  `.resolver.ts` + `commands/upgrade-application.command.ts` +
  **a scheduled version-check cron**,
  `crons/application-version-check.cron.job.ts` (registered via
  `crons/commands/application-version-check.cron.command.ts`, pattern in
  `crons/constants/application-version-check-cron-pattern.constant.ts`) —
  i.e. Twenty already periodically checks installed apps for newer
  versions.
- **Uninstall/Stop**: `application-stop/commands/` (a stop command exists;
  the module name is `application-stop`, not `application-uninstall` —
  verify whether "stop" is a deactivate-in-place vs. full-teardown
  operation before the vertical-apps plan assumes destructive uninstall
  semantics). `application-manifest/dtos/uninstall-application.input.ts`
  confirms an explicit uninstall input DTO exists at the GraphQL layer.
- **Marketplace**: `application-marketplace/` (crons + dtos + utils) — a
  discovery/listing layer for available apps, separate from install.
- **Pre-installed apps**: `application/pre-installed-apps/jobs/` — apps
  that ship enabled by default on workspace creation.
- **Registration & OAuth**: `application-registration/` (register an
  app's identity/manifest with the platform) and `application-oauth/`
  (OAuth client registration, scopes constant referenced by MCP auth in
  §2, stale-registration cleanup cron).

**Conclusion for the vertical-apps plan**: this is not a "small vs large
job" open question — **the framework substantially already exists and is
production-shaped** (install/upgrade/uninstall, permissions down to
row-level, agents, skills, logic functions, front components, connection
providers, marketplace, pre-installed defaults). The Phase 5 work is
primarily (a) confirming/adding workflow-template support to the manifest
if genuinely absent, (b) building the actual vertical content (objects,
views, agent policies) for each named vertical, and (c) whatever gaps a
closer read of `application-manifest/services/` (not opened this pass)
turns up in the parsing/validation of manifests. **Do not scope Phase 5
as "build an app framework" — scope it as "extend an existing app
framework with workflow-manifest support (if missing) and populate it
with vertical content."**

`twenty-sdk` (`packages/twenty-sdk/src/`) is the authoring SDK apps import
against (`sdk/`, `define/`, `cli/`, `front-component-renderer/`,
`logic-function/` per the `dist/` output naming) — this is what a
vertical-app author's `application.config.ts` and unit files (`*.object.ts`
etc.) actually import types from. `twenty-cli` is a thin package
(`deprecate.js` + `package.json`/`README.md` only — appears to be a
deprecated/stub package now superseded by `twenty-sdk`'s own `cli/`
subfolder; **verify this before citing `twenty-cli` as the live CLI** —
the evidence points to `twenty-sdk`'s bundled CLI, not a separate
`twenty-cli` package, being the actual tool).

---

## 7. Standard objects vs core entities — relative cost

Two genuinely different extension mechanisms exist, confirmed by
directory presence (structural/organizational cost estimate — verify
exact registration steps against the actual files before quoting a
task-by-task checklist):

- **Standard object** (e.g. adding a new built-in object like `Person`):
  requires touching `twenty-shared/src/metadata/constants/standard-object.constant.ts`
  and `standard-object-fields.constant.ts` (the canonical registry every
  standard object/field must be listed in), plus a builder under
  `twenty-server/src/engine/workspace-manager/twenty-standard-application/`
  (constructs the standard object's full metadata shape at workspace
  creation time), plus a **workspace migration/upgrade command** so
  already-provisioned workspaces retroactively get the new object/field.
  This is multi-file, cross-package (touches `twenty-shared`, which is
  also consumed by `twenty-front`), and carries a **migration obligation
  for every existing workspace** — expensive, and explicitly forbidden by
  the charter for business-specific/vertical records ("Never add industry
  records to the core schema").
- **Core-schema TypeORM entity** (e.g. `ProposalEntity`,
  `AgentTurnEntity` seen above): a single `*.entity.ts` file under
  `engine/metadata-modules/**/entities/` or `engine/core-modules/**/`,
  registered in its owning NestJS module, with a normal TypeORM migration
  for the `core` schema. No `twenty-shared` metadata registry entry, no
  per-workspace standard-object builder, no cross-workspace upgrade
  command — it's platform infrastructure, not a workspace-visible
  object. This is the pattern the charter's six trust-layer entities
  (`AgentTask`, `AgentRun`, `Evidence`, `Fact`, and the already-existing
  `Proposal`/`ProposalItem`) should follow: **plain `core`-schema TypeORM
  entities alongside `ProposalEntity`, not standard objects** — they are
  workspace-scoped platform entities, not user-visible CRM records, and
  per the charter's own "never add industry records to core schema" rule
  plus their system-managed nature, the TypeORM-entity route (which
  `Proposal`/`ProposalItem` already use) is the correct and dramatically
  cheaper of the two mechanisms.
- **App-manifest custom object** (§6): cheapest of all for anything
  workspace-visible and business-specific — a `.object.ts`/`.field.ts`
  file, no core code change, no cross-package touch, installed/upgraded
  per-workspace through the existing application lifecycle. This is the
  charter-mandated route for all vertical/business records.

---

## 8. Charter trust-layer entities and contracts — direct mapping

| Charter entity | What Twenty already has | Gap to close |
| --- | --- | --- |
| `AgentTask` (durable scheduled work: priority, record target, reason, lease, retry count, budget, idempotency key, cancellation) | **Nothing equivalent as an entity.** The closest *pattern* (not entity) is the cron-claim-and-enqueue compare-and-swap shown in §3 (`syncStage` field used as a lease). No generic task table exists. | Net-new `core`-schema TypeORM entity + BullMQ job pair, built directly on the §3 cron/claim/`GlobalWorkspaceOrmManager.executeInWorkspaceContext` pattern. Genuinely new machinery — but the *pattern* to copy already exists twice in messaging. |
| `AgentRun` (execution status, workflow link, model/provider, transcript, elapsed time, token/cost usage, error details) | Partially: `AgentTurnEntity` + `AgentMessageEntity`/`AgentMessagePartEntity` give transcript; `AiBillingService` gives token/cost usage already wired to billing events. No standalone run status/elapsed-time/error-detail entity independent of a chat thread. | Extend, don't replace: either generalize `AgentTurnEntity` to allow a `null` `threadId` with a `taskId` instead, or add a sibling `AgentRunEntity` that reuses `AgentMessageEntity`/`AiBillingService` for transcript and cost. Do not build new transcript or cost-accounting storage. |
| `Evidence` (immutable observation: source type, locator, observed time, extractor, payload hash, strength, record links) | **Nothing found.** No entity named `Evidence` or similar surfaced in `ai/` or `modules/`. | Net new `core`-schema entity, workspace-scoped, following the `ProposalEntity`/`ProposalItemEntity` file shape exactly (see below). |
| `Fact` (current/superseded sourced assertion: freshness, conflict state, field/value, evidence links) | **Nothing found.** | Net new, same as `Evidence`. |
| `Proposal` (approval envelope: creator, run/workflow source, target records, status, expiry, reviewer) | **Already exists nearly verbatim**: `ai-write-approval/entities/proposal.entity.ts`, `ProposalEntity` — `id`, `workspaceId`, `status: ProposalStatus`, `createdByActor: ActorMetadata`, `threadId` (batches items from one agent turn), `reason`, `expiresAt`, `reviewedByUserWorkspaceId`, `reviewedAt`, `items: ProposalItemEntity[]`. | Essentially complete against the charter's field list. Confirm `ProposalStatus` enum values cover approve/reject/expire/supersede (file `types/proposal-status.type.ts`, not opened this pass — read before the trust-layer plan assumes specific status names). |
| `ProposalItem` (typed create/update/delete/send action: old value, proposed value, evidence, validation result) | **Already exists nearly verbatim**: `proposal-item.entity.ts` — `actionType: ProposalActionType`, `objectNameSingular`, `recordId`, `payload` (proposed values/send payload), `baseline` (values observed at proposal-creation time, re-read at approval to detect concurrent human edits — a stronger safety mechanism than the charter literally asks for), `status: ProposalItemStatus`, `error`, `resultRecordId`. | Missing explicit evidence-links field (charter wants "related evidence" on the item) — add an `evidenceIds`/relation once `Evidence` exists. Otherwise complete. |

### The five contracts

1. **Record contract** (every action uses Twenty objects/fields/relations/
   permissions) — `database-tool.provider.ts` (§2) already generates
   record CRUD tools dynamically from workspace metadata, so this is
   structurally satisfied for tool-driven access; verify it's *only*
   reachable through the standard record-service path (with permission
   checks) and not a raw-SQL shortcut before relying on it.
2. **Execution contract** (versioned, idempotent, cancellable, leased,
   retryable, budgeted) — partially satisfied by BullMQ's own
   retry/backoff config (`queue-retention.constants.ts`, not opened) and
   the claim-lease pattern in §3, but there is no generic idempotency-key
   or cancellation-flag concept yet — this is the `AgentTask` gap above.
3. **Evidence contract** (facts never written without traceable
   observations) — **cannot be satisfied today, `Evidence`/`Fact` don't
   exist**; must be built before any "fact" is ever written.
4. **Proposal contract** (visible diffs, approve/reject/expiry/
   supersession, atomic batch execution) — `ProposalEntity`/
   `ProposalItemEntity`'s `threadId`-batching and `baseline`-vs-`payload`
   diff shape already gives most of this; "atomic batch execution" needs
   verification — read `ai-write-approval/services/*.ts` (not opened this
   pass) to confirm approval executes all items in one transaction before
   the plan claims this is done.
5. **Principal contract** (audit distinguishes user/represented user/
   workflow/agent/integration) — `ProposalEntity.createdByActor:
   ActorMetadata` (from `twenty-shared/types`) suggests a shared
   actor-typing convention already exists across the codebase; find and
   read `ActorMetadata`'s definition before the audit plan invents a new
   principal type — reuse it.

---

## Open items for the four plan authors (explicitly flagged, not silently dropped)

- `ai-agent-execution/services/*.ts` (the async executor) — not opened;
  read before writing the durable-research-agent plan's executor
  integration.
- `ProposalStatus` / `ProposalItemStatus` / `ProposalActionType` enum
  values (`ai-write-approval/types/proposal-status.type.ts`) — not
  opened; read before assuming specific status names.
- `ai-write-approval/services/*.ts` and `resolvers/*.ts` — not opened;
  this is where "approval executes atomically" must be confirmed or
  fixed.
- Whether app manifests support workflow templates (`*.workflow.ts` /
  a workflow converter) — not found in this pass; confirm via a
  targeted search before Phase 5 planning assumes either way.
- Server-side spreadsheet import — this scout found none; confirm via a
  resolver-level grep for `spreadsheet`/`import` mutations before
  concluding it must be built from scratch.
- `application-manifest/services/*.ts` (manifest parsing/validation) —
  not opened; read before estimating vertical-app authoring cost.
- `twenty-cli` vs `twenty-sdk`'s bundled CLI — `twenty-cli` looks
  vestigial (`deprecate.js` only); confirm which one is live before
  citing either in a plan.
- `ActorMetadata` type definition (`twenty-shared/types`) — not opened;
  read before designing the Principal contract's audit shape.
- Exact `@InjectMessageQueue`/queue-retention/backoff defaults
  (`message-queue/constants/queue-retention.constants.ts`) — not opened;
  read before specifying `AgentTask` retry/backoff numbers.
