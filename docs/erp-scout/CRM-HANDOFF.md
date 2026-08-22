# CRM Handoff — findings from the Ever Gauzy scout

**For:** the session consolidating four CRM forks into `searm` (branch `ai-native-crm`), plan at `CRM_CONSOLIDATION_PLAN.md`.
**From:** an ERP-scout pass over `d:/Files/Vatsa/Projects/AI-CRM/ever-gauzy` — a fifth repo that is **not** in your plan. I was scouting it for ERP capability, but a lot of what's in it is plainly CRM, so here it is.

## Licensing — read this first

**Ever Gauzy is AGPL-3.0 across the board** (Nx/yarn monorepo, `packages/core`, `packages/contracts`, `packages/plugins/*`). Same class of obligation as Relaticle and SeaRM core, so *design*-level borrowing is fine and code-level porting is fine only if the distribution decision in Phase 0 already accepts AGPL. Nothing below is MIT. Recommendation for everything marked "port": **reimplement from the described design against SeaRM's contracts, do not copy files** — that is also what your plan already mandates ("capability port, not a Git merge"), and it sidesteps the license question entirely.

---

## 1. Deal / Pipeline / PipelineStage — DUPLICATE

- **Is:** `packages/core/src/lib/deal`, `.../pipeline`, `.../pipeline-stage` — deal entity with stage FK, ordered stages per pipeline, all registered in `app.module.ts`.
- **CRM value:** core sales pipeline.
- **Port cost:** n/a.
- **Verdict:** **DUPLICATE.** Plan §Sales, "Multiple pipelines and customizable stages / SeaRM / Keep — P0". SeaRM's is better. Ignore Gauzy's entirely.

## 2. Contact + OrganizationContact (account/contact master) — DUPLICATE

- **Is:** `packages/core/src/lib/contact` (address/phone primitive) and `.../organization-contact` (the client/account record). Referenced as invoice recipient, income `client`, `TimeLog.organizationContactId`, `Payment.organizationContact`, `Employee.organizationContacts` (m2m = account ownership).
- **Verdict:** **DUPLICATE** of SeaRM's Person/Company. Only note worth keeping: Gauzy demonstrates the *split* between a reusable `Contact` value-object (address/phones) and the account record that references it — SeaRM already models this via metadata.

## 3. Lead / Client models — mostly absent, nothing to take

- Gauzy has **no Lead entity**. `Employee.leads` exists but leads are not a modeled pipeline stage; the "lead" concept is `OrganizationContact` + `Deal`. Candidate (ATS) is the closest thing to a lead funnel and it's a *status enum*, not a configurable stage pipeline (`packages/core/src/lib/candidate/candidate.entity.ts`, status APPLIED/HIRED/REJECTED).
- **Verdict:** nothing to port. Explicitly a **gap in Gauzy**, not a source.

---

## 4. Entity subscription engine (watchers) — **PORT, high value, not in your plan**

- **Is:** `packages/core/src/lib/entity-subscription/*`. One polymorphic table: `(entity: BaseEntityEnum, entityId, employeeId, type)` where `type ∈ {CREATED_ENTITY, ASSIGNMENT, MENTION, COMMENT, MANUAL}`. Producers publish a CQRS `CreateEntitySubscriptionEvent`; the service dedupes on (employee, entity, entityId, org, tenant). Unsubscribe on unassignment removes only the ASSIGNMENT-reason row, leaving a manual watch intact.
- **CRM value:** "who gets notified about this record" is a primitive every CRM needs and SeaRM currently handles ad hoc. The **reason-typed subscription** is the detail most implementations miss — it makes unsubscribe-on-unassign correct without clobbering deliberate follows.
- **Port cost:** Low. ~1 table + 1 service + event wiring. Maps cleanly onto SeaRM's metadata (`objectMetadataId` + `recordId` instead of an enum).
- **Plan status:** **Not covered.** Closest is §Team "Observability" and the notification-adjacent rows; no subscription/watcher primitive is specified.

## 5. Notification engine with per-type preference gating — **PORT, partly new**

- **Is:** `packages/core/src/lib/employee-notification/*` + `employee-notification-setting`. Notification rows carry `(entity, entityId, title, message, type, isRead/readAt, onHoldUntil /*snooze*/, sentByEmployeeId, receiverEmployeeId)`. Titles are built from a placeholder template table (`{action}/{entity}/{entityName}/{employeeName}`, see `employee-notification.helper.ts`). On create, the service loads-or-lazily-creates the receiver's `EmployeeNotificationSetting` (per-channel booleans: assignment/comment/invitation/mention/message/payment, each with `{email, inApp}` preferences) and **silently drops** the notification if disabled.
- **CRM value:** preference-gated, template-titled, event-driven in-app notification store — directly needed for the proposal/approval inbox in your Phase 1 and for §Sales "Tasks, reminders, assignment".
- **Known bug to fix on adoption:** notifications are **not fanned out to entity subscribers**; they only go to an explicitly named `receiverEmployeeId`, and several producers (e.g. `TaskCreateHandler`) call create with none at all. So Gauzy's subscription table is effectively write-only. **Wire #4 → #5 properly.**
- **Port cost:** Medium. Notification store + settings + template resolution is a few days; the fan-out fix is the real design work (subscriber query → per-receiver preference check → channel dispatch).
- **Plan status:** **Partly new.** Plan mentions notifications only implicitly (§AI "Material changes generate proposals and notifications"). No notification model, no preference layer, no snooze. Worth adding a row.

## 6. Mention engine with parent-entity indirection — **PORT**

- **Is:** `packages/core/src/lib/mention/*`. `Mention` = `(entity, entityId, mentionedEmployeeId, actorType, parentEntity?, parentEntityId?)`. The parent fields mean a mention *inside a Comment* resolves up to the Task/record for notification and navigation. `updateEntityMentions` diffs desired vs existing on every update, publishing new and hard-deleting removed. Creating a mention auto-subscribes with type MENTION and publishes a MENTION notification.
- **CRM value:** @-mentions on notes/comments/activities. The **parent indirection** is the piece to copy — without it, a mention in a comment notifies about the comment, not the deal.
- **Weakness to not copy:** `mentionEmployeeIds` are supplied by the *client*, not parsed server-side from the sanitized HTML — trivially forgeable into notification spam. Parse server-side.
- **Port cost:** Low–medium.
- **Plan status:** **Not covered.**

## 7. Polymorphic Comments (threaded, resolvable, assignable) — **PORT**

- **Is:** `packages/core/src/lib/comment/*`. Extends `BasePerEntityType` so it attaches to any record: `comment` text, `actorType`, `resolved/resolvedAt/resolvedByEmployeeId`, `editedAt`, self parent/replies threading, m2m assignment to employees (`comment_employee`) and teams (`comment_team`). Update restricted to the authoring employee.
- **CRM value:** one table serves deal discussion, note threads, proposal review comments. **Resolve** + **assign a comment to a person** are exactly what an approval-inbox needs (your Phase 1 proposal review).
- **Gap:** no COMMENT-type notification is emitted on create despite the template existing — same fan-out hole as #5.
- **Port cost:** Low. SeaRM likely wants this as a metadata-defined object rather than a hardcoded table.
- **Plan status:** **Not covered** as a primitive (plan has "notes" under SeaRM Keep, but no threading/resolve/assign semantics).

## 8. Reactions + generic entity attachments (favorites, resource links) — take the idea, skip the code

- **Is:** `packages/core/src/lib/reaction` (`entity`, `entityId`, `emoji`, author), `resource-link` (title/url/metaData jsonb per entity), `favorite` + `GlobalFavoriteDiscoveryService` — a `@FavoriteService(BaseEntityEnum.X)` decorator scanned at boot via Nest `DiscoveryService` into a `Map<entity, {instance, methods}>`.
- **CRM value:** reactions and record favorites are cheap UX wins; `ResourceLink` is a useful "attach a URL with metadata to any record".
- **Port cost:** Trivial for the tables. **Skip the discovery-decorator registry** — reflection-heavy, fails only at runtime; a typed registry map is safer.
- **Plan status:** Not covered; genuinely optional / P3.

## 9. Generic approval engine (ApprovalPolicy + RequestApproval + M-of-N quorum) — **PORT the concept**, relevant to Phase 1

- **Is:** `packages/core/src/lib/approval-policy`, `.../request-approval`, `.../request-approval-employee`, `.../request-approval-team`.
  - `ApprovalPolicy` = per-org named approval type.
  - `RequestApproval` = polymorphic `requestId` (untyped string) + `requestType` enum + `status` + **`min_count` (quorum)**.
  - Approvers fan out into per-employee and per-team rows, each carrying its own status.
  - `updateStatusRequestApprovalByEmployeeOrTeam` (`request-approval.service.ts:428-461`): set caller's row, count APPROVED, flip parent to APPROVED when `count >= min_count`, immediate REFUSED on any refusal, `ConflictException` on re-deciding a settled request.
  - Any approvable document auto-spawns a companion approval object (see `time-off-request.service.ts:44-68` creating a `RequestApproval` with `min_count: 1`, and `time-off.status.handler.ts` mirroring status back).
- **CRM value:** your plan's §Workflow "Human approval/rejection step — Relaticle — Port as a native workflow action and inbox — P1" and §AI "Batch AI proposals and all-or-nothing approval". Gauzy gives you the **multi-approver M-of-N quorum + team-as-approver** shape that Relaticle's single-approver model probably doesn't, plus the "every approvable document gets a companion approval object" pattern which generalizes directly to your `Proposal` entity.
- **Do NOT copy the implementation:**
  - Polymorphic untyped `requestId` forces hand-written per-dialect SQL casts (Postgres `::varchar`, MySQL `CAST/COLLATE`) — see `request-approval.service.ts:56-180`. Use SeaRM's metadata `(objectMetadataId, recordId)` instead.
  - No sequential stages, no escalation, no delegation/out-of-office, no ordering, no decision audit trail.
  - `updateRequestApproval` **deletes and recreates all approver rows**, silently discarding prior votes.
  - `updateStatusRequestApprovalByAdmin`'s conflict guard is **commented out** (`:416-424`) — an admin can flip a settled request freely.
- **Port cost:** Medium — this is a design to steal, ~2 tables plus quorum logic, but you need to add the stages/escalation/audit that Gauzy lacks.
- **Plan status:** **Partially DUPLICATE** (approval step is P1 from Relaticle). Add the quorum/team-approver/companion-object ideas to that row; note Gauzy as a second reference design.

## 10. Proposal permissions — DUPLICATE / trivial

- `PermissionsEnum.ORG_PROPOSALS_VIEW/EDIT` and `ORG_PROPOSAL_TEMPLATES_VIEW/EDIT` in `packages/contracts/src/lib/role-permission.model.ts` are Gauzy's *sales proposal document* feature, unrelated to your AI "Proposal contract". No overlap, nothing to take.

## 11. Estimate/quote → public acceptance via JWT + DB row — **PORT the pattern**

- **Is:** `packages/core/src/lib/estimate-email/*` + `invoice.subscriber.ts:59-117`. An `EstimateEmail` row stores an expiring JWT (expiry from `organization.inviteExpiryPeriod`, default 7d) plus recipient email and `expireDate`. A `@Public()` `GET /estimate-email/validate` verifies the JWT **and then re-queries the DB** for `{email, token, organizationId, tenantId, expireDate: MoreThan(now)}` before returning tenant/org branding for the anonymous view.
- **CRM value:** the correct pattern for *any* anonymous customer-facing link — public quote acceptance, proposal review by a prospect, approval links emailed to an external stakeholder, payment links. Because the DB row is the second factor, **deleting the row revokes the token instantly** — a plain JWT can't do that.
- **Port cost:** Low. One table + one public validate endpoint.
- **Plan status:** **Not covered.** Your §Workflow "Form, email, and calendar actions" and §AI approval inbox both eventually need an external-recipient link; adopt this.
- Related and also worth a look: `organization-team-join-request` uses **dual code + token** (short alphanumeric code for humans to type, JWT for the click-through link) — nice touch. Do *not* copy `resendConfirmationCode`, which uses `finally { return ... }` and swallows every error while always reporting OK.

## 12. Appointment scheduling / public booking link — **PORT the idea, low priority**

- **Is:** `packages/core/src/lib/employee-appointment/*` + `availability-slots/*`. Appointment carries `bufferTimeStart/End/bufferTimeInMins`, `breakStartTime/breakTimeInMins`, external invitee emails, status, and a JWT-signed appointment id (`signAppointmentId`/`decodeSignToken`, routes `/sign/:id` and `/decode/:token`) so an external party books without an account. `AvailabilitySlot` + `GetConflictAvailabilitySlotsHandler` does interval-overlap conflict detection.
- **CRM value:** meeting-booking links off a contact record (Calendly-style) is a real CRM feature and pairs with your §Sales "Gmail/Google Calendar sync".
- **Port cost:** Medium–high if done properly. Gauzy's is weak: invitees stored as a **comma-joined string**, no recurrence, no timezone handling, no calendar sync, and the SQLite branch of the overlap SQL is **wrong** (only tests whether the new start falls inside an existing slot — misses slots wholly contained in the new range). Take the buffer/break-time modeling and the tokenized public link; write the overlap logic yourself against Postgres `OVERLAPS`.
- **Plan status:** Not covered. Suggest **P2/App**, not core.

## 13. Email history / templates — take the fallback ladder only

- **Is:** `packages/core/src/lib/email-history`, `email-template`, and (better) `accounting-template`. The reusable bit is `AccountingTemplateService.getAccountTemplate`'s **4-tier fallback**: org+tenant → global (null org, null tenant, deliberately bypassing tenant scoping) → English org+tenant → English global. Templates store **both MJML source and compiled HBS**, compiled on write.
- **CRM value:** per-workspace, per-language outbound email/document templating with a sane default chain. Applies to your proposal/approval notification emails and any customer-facing document.
- **Port cost:** Low.
- **Bug to not copy:** `saveTemplate` compiles the **old** `record.mjml` into `hbs` while saving `input.mjml`, so the compiled output lags the source by one edit. It also registers a Handlebars helper on every `generatePreview` call.
- **Plan status:** Not covered.

## 14. Tags / TagType — DUPLICATE-ish, skip

- `packages/core/src/lib/tag-type` is a trivial lookup (`type` string + OneToMany Tag) with `DEFAULT_TAG_TYPES`. Tagging is cross-cutting and SeaRM's metadata handles it. Skip.

## 15. ActivityLog — field-level audit trail — **PORT, complements your Principal contract**

- **Is:** `packages/core/src/lib/activity-log/*`. Generic per-entity audit row: `BasePerEntityType (entity, entityId)` + `action (ActionTypeEnum)` + **`actorType (ActorTypeEnum, user vs system)`** + `description` + jsonb `updatedFields / previousValues / updatedValues / previousEntities / updatedEntities`, written by a subscriber.
- **CRM value:** maps almost 1:1 onto your **Principal contract** ("audit records distinguish the authenticated actor, represented human/team, workflow, agent, and originating integration") and §CRM foundation "Audit trail and field diffs — expose consistent actor/principal and field diff API — P1". Gauzy's `actorType` is a two-value version of what you need; extend the enum to user/agent/workflow/integration.
- **Port cost:** Low, and it's a subscriber so it's non-invasive.
- **Plan status:** **DUPLICATE in intent** (§CRM foundation, P1) but this is a concrete reference schema for the field-diff jsonb shape — use it.
- Sibling worth noting: `api-call-log-middleware.ts` stamps a `correlationId`, decodes the JWT for a userId when `RequestContext` has none, and redacts `authorization/password/token/hash` before persisting. Take the **redaction list and correlation id**; do **not** take persisting full request/response bodies to the DB on every call — storage and PII liability.

---

## Cross-cutting patterns worth stealing (not CRM features, but they shape the port)

| Pattern | Where | Why you care | Plan status |
|---|---|---|---|
| **Scope-cascade metadata with system-default fallback** — `TaskMetadataService.fetchAll` filters on exact `(tenant, org, project, team)` with IS NULL for unspecified levels and falls back to `isSystem=true` rows with all scope columns NULL | `packages/core/src/lib/tasks/task-metadata.service.ts` | The single most reusable idea in the repo. Generalizes to any configurable enum: pipeline stages, deal statuses, proposal states, per-workspace task priorities. Avoids per-tenant seeding hell. Caveat: it's exact-match-then-default, **not** a true cascade up the levels | Not covered |
| **Request-scoped context via AsyncLocalStorage (nestjs-cls)** with static accessors `currentTenantId/currentUserId/currentEmployeeId` | `core/context/request-context.ts` | SeaRM already has workspace context, but the **CLS-stored bypass flag** (`withoutEmployeeFilter(cb)` saving/restoring in a `finally`, explicitly to avoid races between concurrent requests on a singleton service — `tenant-aware-crud.service.ts:33-51, 93-105`) is the right way to model "this agent run legitimately reads outside the caller's scope" | Adjacent to Principal contract |
| **Sprint-move audit row** `(fromSprintId, toSprintId, movedById, reason)` written on every change | `organization-sprint-task-history.entity.ts` | Exact shape for **deal stage-change history** — carry-over/velocity reporting comes free, and `reason` is where an agent's justification goes | Not covered |
| **Permission → manager → self authorization ladder** | `organization-team-employee.service.ts` | Right shape for row-level access on agent-initiated writes. **Bug to not copy:** the manager check queries by whereClause *without* `employeeId`, so it proves *some* manager exists on the team, not that the caller is one — a real privilege bug | §Team, Keep |
| **Feature flags: env default → global Feature row → per-org FeatureOrganization override**, guard 404s (not 403s) on disabled so endpoint existence isn't disclosed | `feature/*`, `shared/guards/feature-flag.guard.ts` | Per-workspace module licensing. The 404 detail is correct and cheap. **Broken as shipped:** `FeatureFlagGuard` caches on `featureFlag_${flag}` with **no tenantId** and reads the global row, never the per-org override — the whole override table is ignored | Not covered |
| **Instructive polymorphic-FK warning** | `request-approval.service.ts:56-180` | Concrete evidence for why your Proposal/Evidence entities should use SeaRM's `(objectMetadataId, recordId)` rather than an untyped string FK: Gauzy pays for it with per-dialect SQL casts and zero referential integrity | Reinforces target architecture |

---

## Recommended additions to `CRM_CONSOLIDATION_PLAN.md`

Three rows I'd add, all sourced from ever-gauzy (AGPL — reimplement, don't copy):

1. **§CRM foundation** — *Record subscriptions, mentions, threaded comments, reactions* | ever-gauzy | Port as metadata-aware polymorphic primitives; wire notifications to fan out to subscribers | **P1**. This is the collaboration substrate your proposal/approval inbox sits on and it is currently missing from the plan entirely.
2. **§Team/security** — *Notification store with per-type/per-channel user preferences, snooze, and template-resolved titles* | ever-gauzy | Port | **P1**.
3. **§Workflow** — extend the existing "Human approval/rejection step (Relaticle, P1)" row to *"…with M-of-N quorum, team-as-approver, and a companion approval object per approvable record (ever-gauzy reference design); add sequential stages, escalation, delegation, and a decision audit trail — none of which either source has."*

And one to **not** add: Gauzy's deal/pipeline/pipeline-stage, contact/organization-contact, and tagging are all inferior to what SeaRM already ships. Don't spend time there.

## What I'd skip outright from ever-gauzy

Candidate/ATS (14 modules — recruiting, not CRM), time-tracking + desktop activity tracker (surveillance tooling, huge surface, no overtime engine), invoicing/finance (tax math lives in the **Angular client**; no double-entry, no FX rates, no credit notes), the multi-ORM abstraction (TypeORM + MikroORM + Knex simultaneously; a 916-line `CrudService` full of `switch (ormType)` and 290 migrations with hand-written triple-dialect SQL), and the ten hand-rolled social passport strategies.

---

# From ERPNext

**Source:** `d:/Files/Vatsa/Projects/AI-CRM/erpnext` (v16), scouted for ERP architecture; this section is only the CRM-relevant slice.

## Licensing — read this first

**ERPNext is GPL-3.0** (`# License: GNU General Public License v3` header on every file). Different licence family from SeaRM's AGPL-3.0: AGPLv3 §13 permits combining with GPLv3 works, but the combined result carries AGPLv3 obligations on the whole. **Do not copy ERPNext files.** Everything below is a *design* to reimplement against SeaRM's metadata contracts — same rule as the Gauzy section, for a different reason.

Also relevant: ERPNext is actively **removing** its CRM module in favour of the standalone **Frappe CRM** app (`erpnext/patches/v16_0/remove_frappe_crm_custom_fields`, `crm_settings_handle_allowed_users_for_frappe_crm`, `CRM Settings.enable_frappe_crm_data_synchronization`, `erpnext/crm/frappe_crm_api.py`). Treat `erpnext/crm/*` as a mature-but-frozen reference design; `frappe-crm` is a separate repo already in this workspace and is the better scout target for CRM depth.

## Findings

### 1. Lead → Prospect → Opportunity → Quotation → Customer funnel — mostly DUPLICATE, one idea new

- **Is:** `crm/doctype/lead/lead.py`, `prospect/prospect.py`, `opportunity/opportunity.py`, `crm/doctype/prospect_lead|prospect_opportunity`. Lead is a *person-or-org* record (`lead_name` from first/middle/last, falling back to `company_name`, then to the email localpart). Prospect is the **account roll-up**: it owns child tables of Leads and Opportunities and mirrors denormalised fields (`amount, stage, deal_owner, probability, expected_closing, contact_person`) onto itself via `Opportunity.update_prospect` / `Lead.update_prospect`. Opportunity is polymorphic on `opportunity_from ∈ {Lead, Prospect, Customer}` + `party_name`.
- **DUPLICATE:** the funnel is Plan §Sales P0 and §CRM foundation P0. SeaRM's metadata model beats a DynamicLink.
- **New, worth taking:** **Prospect as an explicit "several leads + several opportunities under one account" aggregation, created lazily from a Lead** (`Lead.create_prospect`, `add_lead_to_prospect`). This is the missing middle between SeaRM's Person and Company for inbound B2B — multiple unqualified contacts arrive from one company long before anyone is a Customer. Port difficulty: **Low** (a relation/view on SeaRM Company, not a new object).
- **Do not copy:** `Opportunity.map_fields` blind-copies every column name that happens to exist on both the party and the opportunity inside a bare `try/except: continue`.

### 2. Derived funnel status via `has_*` predicates — PORT the pattern, new

- **Is:** `controllers/status_updater.py:status_map` plus `Lead.has_customer/has_opportunity/has_quotation/has_lost_quotation` and `Opportunity.has_active_quotation/has_ordered_quotation/has_lost_quotation`. Lead status (`Lead/Open/Replied/Opportunity/Quotation/Lost Quotation/Interested/Converted/Do Not Contact`) is **not user-asserted** — it is recomputed by scanning downstream documents. Manual states (Do Not Contact, Closed) survive recomputation as self-referential conditions.
- **Why:** kills the "lead says Open but has a won quotation" drift class, and it is exactly the shape an AI agent needs — stage becomes a *function of records*, not a field an agent can assert.
- **Port difficulty:** **Medium** — port the concept (declarative derived status + manual-override escape hatch) as a computed field. Do **not** port the implementation: `frappe.safe_eval`'d Python strings resolved by reversed-list-first-match, one N+1 query per predicate.
- **Plan status:** **New.** Plan has "Multiple pipelines and customizable stages — Keep" but nothing on derived vs asserted stage.

### 3. Lost reasons + competitor tracking — PORT, cheap, new

- **Is:** `Opportunity.declare_enquiry_lost(lost_reasons_list, competitors, detailed_reason)` + `Opportunity Lost Reason`, `Competitor`, `Competitor Detail`; mirrored on Quotation (`quotation.py:declare_enquiry_lost`). Guard: **cannot mark Lost while an active submitted Quotation exists.**
- **Why:** structured loss reasons plus a named competitor per lost deal is the highest-value-per-byte analytics field a CRM can add, and it is two lookup tables. The "can't lose it while a live quote exists" invariant keeps win/loss reporting honest.
- **Port difficulty:** **Low.**
- **Plan status:** **New** — absent from the plan entirely.

### 4. Contract + Contract Template with fulfilment checklist — PORT, new

- **Is:** `crm/doctype/contract/contract.py`, `contract_template`, `contract_fulfilment_checklist`, `contract_template_fulfilment_terms`. Links polymorphically to a Quotation/Sales Order/Project/Invoice, carries template-rendered `contract_terms`, signature capture (`is_signed, signee, signed_on, ip_address, signed_by_company, party_user`), and **two independent status axes**: `status ∈ {Unsigned, Active, Inactive, Cancelled}` derived from `is_signed` + date range by a nightly job, and `fulfilment_status ∈ {N/A, Unfulfilled, Partially Fulfilled, Fulfilled, Lapsed}` derived from a checklist of fulfilment terms against a `fulfilment_deadline`.
- **Why:** the plan has no contract object at all, and separating "is this contract in force" from "have we delivered on its terms" is the correct model that most CRMs collapse. `Lapsed` is free renewal/risk signal, and the checklist is directly agent-actionable ("which terms are outstanding on this account").
- **Port difficulty:** **Low–Medium** — two objects, a checklist child, a nightly status job. IP-and-timestamp signature capture is legally thin; pair with a real e-sign provider.
- **Plan status:** **New.**

### 5. Campaign + Email Campaign drip sequences — partly DUPLICATE, take the scheduling model

- **Is:** `crm/doctype/campaign` (campaign with `campaign_schedules`: `send_after_days` + `email_template`) and `crm/doctype/email_campaign/email_campaign.py` — one row per **recipient enrolment** (campaign + recipient + `email_campaign_for ∈ {Lead, Contact, Email Group}` + start_date; `end_date = start_date + max(send_after_days)`). A daily job walks In-Progress enrolments, matches `start_date + send_after_days == today`, renders the template with the recipient doc as context, sends. Status is date-derived (`Scheduled/In Progress/Completed`) except `Unsubscribed`, which is terminal.
- **Take:** the enrolment-row-per-recipient with relative-day schedule; the duplicate-enrolment guard (`validate_email_campaign_already_exists`: same campaign + recipient + active status); unsubscribe as a terminal state distinct from completion.
- **DUPLICATE-ish:** Plan §Installable solutions "Marketing/target-account campaigns and memberships — crmkit — App — P2". Add this as a second reference design on that row.
- **Do not copy:** day granularity only (no time of day, no timezone), no send window or throttle, no reply-detection stop, no A/B, no conditional exit. `send_mail` swallows failures into the error log inside a savepoint and returns a possibly-unbound `comm`.
- **Port difficulty:** **Low** for the model; the missing pieces (reply-stop, throttling) are the actual work.

### 6. Public appointment booking with double-booking-safe capacity — PORT, new, best code in the CRM module

- **Is:** `crm/doctype/appointment/appointment.py` + `appointment_booking_settings`, `availability_of_slots`. Anonymous portal booking → status `Unverified` → hashed email-verification token (`sha256_hash` stored, raw key only in the emailed link) → on verify, status `Open` and the record **materialises**: find-or-create Lead by email, auto-assign an agent, create a calendar Event with participants. Validations: no backdating, `advance_booking_days` cap, holiday-list check, must fall inside a configured weekday slot, capacity vs `number_of_agents`.
- **Why it is good:** `count_overlapping_appointments(..., for_update=True)` takes a **locking read over the overlapping window** so two simultaneous bookings cannot both pass the capacity check — and it deliberately selects rows rather than `COUNT()` because Postgres rejects `FOR UPDATE` with an aggregate. Agent selection: prefer whoever owns the party's **latest opportunity**, else the least-loaded agent for that day excluding agents already busy in the window. Expired unverified bookings are swept by a job with a configurable close-vs-delete policy.
- **Port difficulty:** **Medium.** Take: hashed-token verification, the `FOR UPDATE` capacity check, unverified-expiry sweep, opportunity-owner-then-least-loaded assignment. Rewrite: slots are weekday+time only (no per-agent calendars, no timezones, no recurrence, no reschedule flow), and `_get_agents_sorted_by_asc_workload` seeds a Counter with agent names then sorts by count — clever, unreadable.
- **Plan status:** **New**, and it **supersedes handoff §12** (ever-gauzy appointments, whose overlap SQL is outright wrong). One row: *Public booking link with verified email, capacity-safe slots, auto-assignment — ERPNext reference — P2/App*.

### 7. Service Level Agreement engine — PORT the design, new, high value

- **Is:** `support/doctype/service_level_agreement/service_level_agreement.py` (1060 lines) + `issue.py`, `service_level_priority`, `service_day`, `pause_sla_on_status`, `sla_fulfilled_on_status`, `issue_priority`.
  - **Generic, not ticket-specific:** an SLA declares a `document_type` and is applied by a `validate` hook to *any* doctype, injecting SLA fields (`response_by, sla_resolution_by, agreement_status, first_responded_on, on_hold_since, total_hold_time`) into the target.
  - **Resolution order:** explicit SLA → customer → customer-group ancestors → territory ancestors → an SLA with no entity → the flagged `default_service_level_agreement`, with an optional `safe_eval` condition against the doc. Nested-set ancestor expansion means "SLA for all of EMEA" works.
  - **Business-hours clock:** `get_expected_time_for` walks forward day by day over `support_days` (per-weekday start/end), skipping holiday-list dates, consuming `allotted_seconds` — deadlines are in *working* hours, not wall-clock.
  - **Pause/resume state machine:** each SLA names its own hold statuses and fulfilled statuses; `handle_status_change` enumerates all six Open↔Hold↔Closed transitions, accumulates `total_hold_time`, resets `resolution_by` on hold, recomputes on reopen, records `first_responded_on`, and calls `record_assigned_users_on_failure` when first response missed `response_by`.
- **Why:** the plan's §Installable solutions row *"Customer support tickets, requester, assignee, conversation, SLA — crmkit — App — P2"* is one line; this is the specification behind it. Business-hours arithmetic + pause-while-waiting-on-customer + first-response and resolution as separate clocks is what separates a real SLA from a `due_date`. It also generalises past support: the same engine gives **lead-response SLAs** ("first touch within 2 business hours") — an AI-native use case, since the agent is then measured on the same clock as the human.
- **Port difficulty:** **Medium–High.** The business-hours/holiday clock and the hold-time accumulator are the real work (~a week done properly); the rest is config.
- **Do not copy:** applying an SLA **mutates the target doctype's schema** (creates custom fields) — model SLA state as a related record in SeaRM. Also `safe_eval`'d conditions, N+1 lookups per hold/fulfilled status, and `apply()` as a wildcard `validate` hook on every doctype guarded only by a cache lookup.
- **Plan status:** **DUPLICATE in intent** (§Installable solutions, P2) — attach as the reference design, and consider promoting the lead-response-SLA half to P1.

### 8. Communication / comment / event carry-forward on conversion — PORT, new, small and important

- **Is:** `crm/utils.py` — `copy_comments`, `link_communications`, `link_open_tasks`, `link_open_events`, `link_communications_with_prospect`, `link_events_with_prospect`, gated by `CRM Settings.carry_forward_communication_and_comments`. When a Lead becomes an Opportunity (or joins a Prospect), comments are cloned and Communications/Events/ToDos are **re-linked** (via `Communication Link` timeline rows) to the new record, so conversation history follows the funnel. `update_modified_timestamp` bumps `modified` on an inbound Communication so "stale record" views stay honest.
- **Why:** every CRM that models Lead and Opportunity as separate objects has this problem and most solve it badly (history stranded on the dead Lead). The **many-to-many timeline link** — one Communication visible on the Lead *and* the Prospect *and* the Opportunity — is the right answer, not a copy and not a move.
- **Port difficulty:** **Low.** SeaRM already has timeline activities; this is a link-fanout rule on conversion plus a settings toggle.
- **Plan status:** **New.** §Sales has "Activity timeline — Keep" but is silent on what happens to it on conversion/merge — and §CRM foundation "Dedupe and identity resolution / merge review — P1" needs exactly this rule.
- **Also:** `CRMNote` mixin (`crm/doctype/crm_note`) — an `(note, added_by, added_on)` child table with `notify_mentions` wired in, shared by Lead/Opportunity/Prospect. Cheaper than Gauzy's polymorphic Comment (§7) but strictly less capable; prefer Gauzy's shape, take ERPNext's mention hook.

### 9. Contact/Address linking via Dynamic Link — DUPLICATE, one cautionary note

- **Is:** Frappe's `Contact`/`Address` with a `Dynamic Link` child table (`link_doctype`, `link_name`), so one Contact attaches to Lead + Customer + Prospect at once. `Lead.before_insert` auto-creates a Contact (`CRM Settings.auto_creation_of_contact`); `crm/utils.py:update_lead_phone_numbers` syncs the Contact's primary phone/mobile **back down** onto the Lead.
- **DUPLICATE:** SeaRM's metadata relations cover this properly. The value here is the demonstrated **cost** of denormalising: a hand-written back-sync hook per field, plus `Opportunity.onload` manually merging two contact/address lists. Reinforces "use real relations, never copy contact fields onto the deal".

### 10. Quotation flow (quoting a Lead, not just a Customer) — partly new

- **Is:** `selling/doctype/quotation/quotation.py` + `SellingController.set_missing_lead_customer_details`. A Quotation can be raised against a **Lead** (`quotation_to == "Lead"`), pulling party details from it; on submit it back-propagates — `update_lead` recomputes Lead status, `update_opportunity` flips the source Opportunity to Quotation/Converted/Lost. `valid_till` plus a nightly `set_expired_status` job moves live quotes to `Expired`; status also derives `Ordered / Partially Ordered` from downstream Sales Order lines. `carry_forward_communication` again re-links history.
- **Why:** quoting a Lead you have not yet converted is a real B2B need and a natural home for the AI proposal path (agent drafts, human approves, submission advances the funnel). The `valid_till` → auto-`Expired` sweep is a cheap freshness signal.
- **Port difficulty:** **Medium** — a quote object with line items, currency and validity drags in pricing; likely an **App**, not core.
- **Plan status:** **New.** The plan has no quote-document object — and note the name collision: the plan's "Proposal" is the AI diff contract, not a customer-facing proposal. Resolve that naming early.

## Recommended additions to `CRM_CONSOLIDATION_PLAN.md`

From ERPNext (**GPLv3 — reimplement, do not copy**):

1. **§Sales** — *Structured lost reasons + competitor per lost deal, with a "cannot lose while a live quote exists" guard* | ERPNext | Port | **P1**. Cheapest high-value analytics field in the whole scout.
2. **§Sales** — *Derived funnel status computed from downstream evidence, with explicit manual-override states* | ERPNext | Port as computed field | **P1**. Serves the plan's "an LLM confidence score is not evidence" principle directly.
3. **§CRM foundation** — *History carry-forward on conversion/merge: re-link (don't copy) communications, events, tasks and comments to the new record* | ERPNext | Port | **P1**. Prerequisite for the existing dedupe/merge-review row.
4. **§Installable solutions** — expand the support-ticket row to *"…including a generic SLA engine: business-hours response/resolution clocks over a holiday calendar, pause-on-hold status sets, first-response tracking, and entity→group→territory→default SLA resolution (ERPNext reference design); also applicable to lead-response SLAs"* | **P2**, with the lead-response half promoted to **P1**.
5. **§Sales / App** — *Contract object with template-rendered terms, signature capture, and a fulfilment checklist whose status (Unfulfilled/Partial/Fulfilled/Lapsed) is tracked separately from contract validity* | ERPNext | App | **P2**.
6. **Supersede handoff §12** (ever-gauzy appointments) with ERPNext's booking design — hashed-token email verification, `FOR UPDATE` capacity check, unverified-expiry sweep, opportunity-owner-then-least-loaded assignment | **P2/App**.

## What I'd skip outright from ERPNext

Everything outside `crm/` and `support/`: accounting core, stock/valuation, taxes, POS, subscriptions, dunning, bank reconciliation, payroll — all ERP, none of it CRM, all GPLv3. Also skip `Warranty Claim` (thin Issue variant keyed to serial numbers), `Sales Team`/commission (hits payroll and GL), the lookup tables (`Market Segment`, `Industry Type`, `Sales Stage`, `Opportunity Type` — SeaRM select fields), and the Frappe-CRM sync bridge (`crm/frappe_crm_api.py`, `CRM Settings.enable_frappe_crm_data_synchronization`), which exists solely to hand this module off to another app.

**Scout note:** since ERPNext is actively deprecating this module, `frappe-crm` and `frappe-helpdesk` (both already cloned in this workspace) are the higher-yield next targets — helpdesk in particular is where the SLA engine above has been rebuilt properly.

---

# From Odoo

**Source:** `d:/Files/Vatsa/Projects/AI-CRM/odoo` (19.0), addons `crm/`, `mail/`, `calendar/`, `mass_mailing/`, `utm/` and `odoo/addons/base/models/res_partner.py`.

## Licensing — read this first, it changes the rules

**Odoo Community is LGPL-3.0** — every one of these addons declares `'license': 'LGPL-3'` in its `__manifest__.py`, and the repo `LICENSE` is LGPLv3. This is **materially more permissive than the AGPL/GPL sources in the sections above**:

- LGPL permits **linking from a larger work under any licence**, including closed/commercial. AGPL/GPL do not.
- So Odoo is the **only** scouted source where you could legally *copy* algorithm-level code, if it stays in an LGPL-licensed module boundary and you honour §4 (relinking/modification rights, notice, source of the LGPL part).
- Practically: **still reimplement.** Python/ORM-coupled code doesn't survive a port to SeaRM's NestJS/metadata stack, and keeping an LGPL boundary inside a TS monorepo is more compliance overhead than the code is worth. But when a specific algorithm (Naive-Bayes lead scoring, the weighted-random assignment loop, the RFC-5322 routing rules) is worth lifting near-verbatim, **Odoo is the one repo where you may.** Flag that to whoever owns the Phase-0 licence review.

## A — `crm/` (the CRM addon itself)

| # | Capability | What it is / source | Why worth having | Port | Status |
|---|---|---|---|---|---|
| A1 | **One model for Lead + Opportunity** (`type in {lead, opportunity}`) | `crm/models/crm_lead.py:123`, 2890 lines, one table | No conversion-loses-history problem at all — conversion is a field write (`convert_opportunity`, `:1850`). Sidesteps the ERPNext §8 carry-forward problem entirely. Contrast with ERPNext's separate Lead/Prospect/Opportunity before deciding SeaRM's shape. | n/a — architectural choice | **Decide, not port.** Relevant to plan §Sales P0 |
| A2 | **Duplicate detection: 3 exact-match criteria** — same email *domain* (`email_domain_criterion`, free-provider domains excluded), same `phone_sanitized`, same `commercial_partner_id` ancestor | `crm_lead.py:508` (`_compute_email_domain_criterion`), `:624` `_compute_potential_lead_duplicates` | Cheap, deterministic, no fuzzy matching, and **caps out at 21 results and returns empty above the cap** — "too many matches means the criterion is meaningless" is the right failure mode. Runs sudo + `active_test=False` deliberately so managers see cross-company/archived dupes. | **Low** | Serves §CRM foundation "Dedupe and identity resolution — P1". **New detail**, complements crmkit/crm |
| A3 | **Merge with confidence-ranked winner + non-destructive history move** | `_sort_by_confidence_level` (`:1943`), `_merge_data` (`:1479`), `_merge_dependences_*` (`:1627-1706`), `_merge_followers` (`:1707`) | Best merge implementation in the whole scout. Winner picked by `(not lost, is opportunity, stage.sequence, probability, -id)`. Field merge rule per type: text concatenated, m2o = first-not-null in winner order, x2m skipped, address fields taken **as a coherent block from one record** not field-by-field. Messages/activities/attachments/calendar events are **re-parented** (`res_id` rewrite) with the source name prefixed into the subject, not copied. Followers move only if that partner **posted in the last 30 days** — one SQL, dedup against existing followers. Merge posts a summary message. Hard cap of 5 records unless superuser. | **Medium** | §CRM foundation "merge review — P1". **New**, and strictly better than anything else scouted |
| A4 | **Naive-Bayes predictive lead scoring (PLS)** | `_pls_get_naive_bayes_probabilities` (`:2194`), frequency table `crm.lead.scoring.frequency`, nightly `_cron_update_automated_probabilities` (`:2397`) | A real, explainable, no-LLM scoring model: per-team frequency counts of (field, value) to won/lost, Laplace-smoothed with +0.1 to dodge zero-frequency, probability = S(won)/(S(won)+S(lost)). Fields are admin-configurable (`crm.pls_fields`), start date bounded (`crm.pls_start_date`), and it exposes a **per-(field,value) score breakdown tooltip** (`prepare_pls_tooltip_data`, `:2813`). `probability` is user-overridable; `automated_probability` and `is_automated_probability` track whether a human has taken over. | **Medium** | **New.** Directly relevant to the plan's "an LLM confidence score is not evidence" principle — this *is* evidence-shaped scoring, per-feature attributable, and cheap. Suggest §AI-native, **P1** |
| A5 | **Rule-based lead allocation: weighted-random teams, then quota'd members** | `crm_team.py:_allocate_leads` (`:323`), `_action_assign_leads` (`:224`), `crm_team_member.py:_get_assignment_quota` (`:90`) | Teams carry `assignment_max` (leads/30 days) + an `assignment_domain`; the cron picks a team by **weighted random choice on `assignment_max`**, takes its top unassigned lead, and merges its duplicates in the same step so dupes never land on two teams. Members then get `assignment_max/30` per day minus what they already got in 24h, with **two domains per member: `assignment_domain` (eligible) and `assignment_domain_preferred` (served first)**. Commits every N leads so a cron crash doesn't loop forever. | **Medium** | **New.** Plan has no assignment/round-robin row at all. Suggest §Sales, **P1** — this is the AI-agent-friendly shape (capacity + declarative eligibility domain, not a code hook) |
| A6 | **Rotting / staleness as a first-class stage property** | `mail_tracking_duration_mixin.py` (`rotting_days`, `is_rotting`, searchable), `crm_stage.rotting_threshold_days`, `crm_lead._get_rotting_domain` (`:396`) | Per-stage "days before this goes stale" beats a global staleness rule; and `is_rotting` has a `search=` so it works in list filters and workflow triggers. | **Low** | §Sales "Outreach count and last-outreach signals — crmkit — P1" — **add this as the better model** |
| A7 | **`duration_tracking`: time-in-each-stage, derived from the tracking log** | `mail_tracking_duration_mixin.py:_compute_duration_tracking` | Json `{stage_id: seconds}` computed from `mail.tracking.value` history — no separate stage-history table. Cycle-time/velocity analytics for free once you have field tracking. Requires the m2o be `tracking=True`. | **Low** (given B4) | **New.** Supersedes handoff "Sprint-move audit row" (ever-gauzy) as the deal-stage-history mechanism |
| A8 | Lost reasons | `crm_lost_reason.py` (35 lines), `crm_lead.action_set_lost` | Trivially thin — a named lookup plus `lost_reason_id`. | n/a | **DUPLICATE** of ERPNext §3, which is better (competitors, detailed reason, live-quote guard). Take ERPNext's. |
| A9 | Stages, `is_won`, `fold`, per-team stages, `requirements` tooltip | `crm_stage.py` | — | n/a | **DUPLICATE** — SeaRM §Sales P0 |
| A10 | Recurring revenue on the opportunity (`recurring_plan`, MRR, prorated revenue) | `crm_lead.py:143-151`, `crm_recurring_plan.py` | Prorated + MRR + one-off on the same record; small but the correct shape for SaaS pipelines. | **Low** | **New**, optional. §Sales P3 |

## B — `mail/` (the chatter) — the highest-value subsystem in Odoo

12,600 lines across the models below. This is `mail.thread` — an abstract mixin any model inherits to gain a message log, followers, activities, field tracking and an inbound email gateway.

| # | Capability | Source | Why worth having | Port | Status |
|---|---|---|---|---|---|
| B1 | **`mail.thread` as a mixin, not a feature** | `mail/models/mail_thread.py` (5137 lines) | Every business object gets chatter by declaring one inherit. In SeaRM terms: chatter is a **capability applied to an object metadata definition**, not a hardcoded table per record type. Get this shape right before building anything on top. | architectural | **New framing.** Plan has "Activity timeline — SeaRM — Keep" with no mixin concept |
| B2 | **Follower + subtype subscription model** | `mail_followers.py` (557), `mail_message_subtype.py` | `mail.followers = (res_model, res_id, partner_id, subtype_ids)` with a unique constraint on (model, res_id, partner). **Subtypes are the per-topic granularity** ("stage changed", "new note", "assigned") — a follower subscribes to a *subset*. `internal` subtypes are employee-only; `parent_id` + `relation_field` enable **cascading auto-subscription** (follow a project, get task-level subtypes). This is a strictly more capable version of handoff §4 (ever-gauzy entity-subscription): reason-typing there vs topic-typing here — you want **both axes**. | **Medium** | **Supersedes/extends handoff §4.** §CRM foundation, **P1** |
| B3 | **Auto-subscribe on assignment, with notification** | `_message_auto_subscribe` (`:4776`), `_message_auto_subscribe_followers` (`:4706`) | Any tracked m2o to `res.users` named `user_id` auto-subscribes the assignee and sends a rendered "You have been assigned to X" notify — **unless the assigner is the assignee**. `followers_existing_policy` lets a caller choose skip/replace on re-subscribe. Exactly the fix for the ever-gauzy §5 fan-out hole. | **Low** | **New.** Wire with B2 |
| B4 | **Field-level tracking to message + typed diff rows** | `_message_track` (`:644`), `mail_tracking_value.py` | `tracking=<int>` on a field; on write, changed fields produce `mail.tracking.value` rows (typed columns per datatype plus a `field_info` Json fallback for **fields later deleted from the schema**), attached to a `mail.message`. `_track_subtype(initial_values)` lets a model pick which subtype a given change posts under (crm posts a different subtype for won vs lost — `crm_lead.py:2088`). Crucially `_filter_has_field_access` **re-checks field ACLs when rendering the diff**, so tracking is not a permission leak. | **Medium** | §CRM foundation "Audit trail and field diffs — P1" — **this is the reference schema**, better than ever-gauzy §15 (typed columns + ACL recheck + deleted-field survival) |
| B5 | **Inbound email gateway / routing** | `message_route` (`:1121`), `_routing_check_route` (`:846`), `message_new`/`message_update` (`:1514`/`:1547`), `mail_alias.py` | Route order: (1) reply-detection by `References`/`In-Reply-To` against stored `message_id` — **truncated to the last 32 refs, with a comment that 100+ refs degrades perf**; (2) `mail.alias` local-part match against To/Cc/Delivered-To, filtered by allowed catchall domains; (3) declared fallback model; else raise. An alias defines its own model, defaults and owner. `crm.lead.message_new` (`:2125`) turns an inbound mail into a lead with `email_from` to partner matching. | **Medium–High** | **New.** Plan has "IMAP/SMTP/CalDAV — SeaRM — Keep" but nothing on **record-creating aliases** (`sales@` creates a lead). Suggest §Sales, **P1** |
| B6 | **Bounce + loop protection** | `_routing_handle_bounce` (`:785`), `_detect_loop_sender` (`:1003`), `_detect_loop_headers` (`:1091`), `_detect_write_to_catchall` | Bounces are parsed, mapped back to the originating `mail.notification` (status `bounce`, `failure_type='mail_bounce'`), and propagated to **every blacklist-enabled record sharing that normalized email**, incrementing `message_bounce`. Loop protection is three-layer: a marker in the bounce Message-Id (`-loop-detection-bounce-email@`), a per-sender rate check on records created by the same alias, and "all recipients are catchall, drop". | **Medium** | **New and non-obvious.** Any CRM with an inbound alias will get auto-replier loops in week one. **P1** if you take B5 |
| B7 | **Blacklist / opt-out as a mixin** | `mail_blacklist.py`, `mail_thread_blacklist.py` | One global `mail.blacklist` table keyed on normalized email; `mail.thread.blacklist` gives any model `email_normalized` (trigram index), computed `is_blacklisted` with a working `_search_is_blacklisted`, and `message_bounce`. Blacklist is `active`-toggled, not deleted, and every add/remove posts a tracked message — the audit trail is the point. | **Low** | **New.** Legally required (CAN-SPAM/GDPR) the moment you send outbound. §CRM foundation, **P1** |
| B8 | **Activities: scheduled next-actions with chaining** | `mail_activity.py` (878), `mail_activity_type.py`, `mail_activity_mixin.py` (487) | `mail.activity = (res_model, res_id, activity_type_id, summary, note, date_deadline, user_id, state)`; `state` is **computed from the deadline** (`overdue/today/planned`), never stored-and-drifting. Types carry a delay (`delay_count`/`delay_unit`/`delay_from in {current_date, previous_activity_deadline}`), an icon/decoration, mail templates, and **`chaining_type` = suggest-next vs trigger-next** — completing a "Call" auto-schedules "Send quote". `mail_activity_mixin` gives any model `activity_ids`, `activity_state`, `activity_summary` **as searchable fields**, so "my overdue accounts" is a plain filter. | **Medium** | §Sales "Tasks, reminders, assignment — P1" is **partly DUPLICATE**, but chaining, deadline-derived state, and mixin-searchability are **new**. The distinction *activity (future intent) vs message (past record)* is the design insight |
| B9 | **Activity plans** | `mail_activity_plan.py`, `mail_activity_plan_template.py` | A named, per-model, ordered set of activity templates applied in one action ("Onboarding: 5 tasks to 3 roles"), with `has_user_on_demand` for steps whose assignee is chosen at launch. Playbooks without a workflow engine. | **Low** | **New.** §Sales/§Workflow, **P2** |
| B10 | **Deferred/scheduled sending, two layers** | `mail_message_schedule.py` (notification-level), `mail_scheduled_message.py` (author-level draft) | `mail.message.schedule` delays *notification dispatch* for an already-posted message (the "you have 15 min to undo" pattern, cron-triggered via `ir.cron._trigger(at=...)`); `mail.scheduled.message` is a **user-composed message queued to post later**, editable/cancellable until sent. Two genuinely different needs, correctly separated. | **Low** | **New.** Pairs with the plan's approval-gated outbound (§Workflow step 4) |
| B11 | **Notification records per recipient** | `mail_notification.py` | `(mail_message_id, res_partner_id, notification_type in inbox/email, notification_status in ready/process/sent/bounce/exception, failure_type, failure_reason)` — per-recipient delivery state, which is what makes B6 bounce-mapping and "message failed to N recipients" possible. | **Low** | **New**; upgrade over ever-gauzy §5's single-receiver row |
| B12 | Templates + `mail.render.mixin` | `mail_template.py` (828), `mail_render_mixin.py` (853) | QWeb/inline-Jinja rendering with a **sandboxed eval and a per-field render allowlist**, `lang` resolution per recipient, `_replace_local_links` for absolute URLs in email. | **Medium** | Partly DUPLICATE (handoff §13 ERPNext/Gauzy templating). Take the **per-recipient language resolution** and link absolutization |
| B13 | Canned responses | `mail_canned_response.py` (85) | Shortcut to substitution, per-user or shared to groups. Trivial, high perceived value. | **Trivial** | New, P3 |

## C — `calendar/`

| # | Capability | Source | Why | Port | Status |
|---|---|---|---|---|---|
| C1 | **Recurrence as a separate record, not an rrule string on the event** | `calendar_recurrence.py` — `calendar.recurrence` with structured fields (`rrule_type, interval, count, until, mon..sun, month_by, byday, weekday`) **plus** a computed/inverse `rrule` char | Structured fields are queryable and form-editable; the RFC-5545 string is derived both ways. `_apply_recurrence` materialises concrete `calendar.event` rows and `_reconcile_events` re-syncs them on edit, so a single occurrence can be detached and edited. `event_tz` is stored on the recurrence — **the timezone the rule was authored in**, which is the only correct way to survive DST. | **High** | **New.** Supersedes handoff §12 (ever-gauzy, no recurrence/tz) and ERPNext §6 (no recurrence). §Sales P2 |
| C2 | **Attendees with per-attendee token + RSVP state** | `calendar_attendee.py` — `(event_id, partner_id, state in needsAction/tentative/accepted/declined, access_token, availability)` | `access_token` per attendee is the **anonymous accept/decline link** — the same second-factor pattern as handoff §11, applied to meetings. `_should_notify_attendee` gates invitation mail so you don't spam the organiser. | **Low** | **New.** P2 |
| C3 | Alarms | `calendar_alarm.py`, `calendar_alarm_manager.py` | `alarm_type in {email, notification}` crossed with `duration`/`interval`, normalised to `duration_minutes` (with a working `_search_duration_minutes`), plus a `notify_responsible` flag. Alarm manager batches upcoming triggers off a cron. | **Low** | New, P2 |
| C4 | Meeting/opportunity link | `crm/models/calendar.py`, `crm_lead.action_schedule_meeting` (`:1266`), `log_meeting` (`:1454`), `_compute_meeting_display` (`:589`) | Meetings carry `opportunity_id`; scheduling one from a lead prefills partner/name, and the meeting is **logged back into the lead's chatter**. The lead surfaces "next meeting date" or, if none, "last meeting date" in one computed pair. | **Low** | **DUPLICATE-ish** (§Sales "Gmail/Google Calendar sync — Keep") but the *next-else-last* display and the chatter log-back are new details |

## D — `mass_mailing/` + `utm/`

| # | Capability | Source | Why | Port | Status |
|---|---|---|---|---|---|
| D1 | **`utm.mixin` — campaign/source/medium on any record, auto-captured from cookies** | `utm/models/utm_mixin.py` | Three m2o (`campaign_id`/`source_id`/`medium_id`, all `btree_not_null` indexed) added by inheriting one mixin; `default_get` reads them from request cookies set by the HTTP layer, and find-or-creates by name so an unknown `utm_source` doesn't drop the attribution. **Deliberately skipped for salespeople** so a rep opening a form doesn't inherit their own browsing attribution — a real bug class, handled. | **Low** | **New.** Plan has no attribution row at all. §CRM foundation / §Sales, **P1** — cheap, and it is the join key for every marketing ROI question |
| D2 | **`mailing.trace` — one row per (mailing, recipient) with a lifecycle** | `mass_mailing/models/mailing_trace.py` | `(mass_mailing_id, model, res_id, email, message_id, campaign_id)` plus `trace_status in outgoing/process/pending/sent/open/reply/error/cancel/bounce` with a **timestamp per transition** (`sent_datetime`, `open_datetime`, `reply_datetime`, `links_click_datetime`) and a typed `failure_type`. `mail_mail_id_int` keeps the integer id after the `mail.mail` row is garbage-collected, so stats survive cleanup. Open/click/reply are idempotent state upgrades, never downgrades. | **Low–Medium** | **New.** Better than ERPNext §5's status field. §Installable solutions campaigns row, **P2** — but the *trace* concept is P1 if you send anything |
| D3 | **Opt-out per (contact, list) with a reason** | `mailing_subscription.py`, `mailing_subscription_optout.py` | Membership row `(contact_id, list_id, opt_out, opt_out_reason_id, opt_out_datetime)`, unique per pair. **Opt-out is per-list, blacklist is global** — two different consent levels, correctly separated (see B7). Reasons are a lookup with `is_feedback` for free-text prompts. | **Low** | **New.** Compliance-relevant. **P1** alongside B7 |
| D4 | **Send-time dedup: `_get_seen_list` + `_get_remaining_recipients`** | `mailing.py:974`, `:1039` | Recomputes the recipient domain **at send time**, then subtracts everyone already traced — so a paused/resumed/retried mailing never double-sends, and in A/B mode it dedups **across the whole campaign**, not just the mailing. | **Low** | **New.** The single most important correctness rule in bulk sending |
| D5 | A/B testing | `mailing.py` (`ab_testing_pc`, `ab_testing_winner_selection`, `ab_testing_schedule_datetime`), `_get_recipients` random sampling | Percentage split with a CHECK constraint, campaign-level winner selection, and a winner-mailing that targets everyone the siblings didn't. | **Medium** | New, **P2/App**. Fills the "no A/B" gap called out in ERPNext §5 |
| D6 | `mailing.filter` — saved, reusable recipient domains | `mailing_filter.py` | Named saved segments per model, reusable across mailings. Segment-as-a-record is the agent-friendly shape. | **Trivial** | New, P2 |

## E — `res.partner` (contact/company master)

| # | Capability | Source | Why | Port | Status |
|---|---|---|---|---|---|
| E1 | **One table for company, contact and address** — `is_company` + `parent_id` + `type in {contact, invoice, delivery, other, private}` | `odoo/addons/base/models/res_partner.py:254-302` | Everything addressable is a partner. Debatable, and SeaRM's Person/Company split is probably better for a CRM — but note what it buys: any relation pointing at "a party" needs exactly one FK. | n/a | **DUPLICATE / decided.** SeaRM wins here |
| E2 | **`commercial_partner_id` — the billing/legal entity of any contact** | `:302`, `:514` — computed as `self if is_company or no parent else parent.commercial_partner_id` | The **single most reusable idea in `res.partner`**. It resolves any contact, at any depth, to its root commercial entity in one stored, indexable field. Powers portal visibility rules (`child_of commercial_partner_id`), "all leads for this account", duplicate detection (A2), and credit limits. SeaRM needs the equivalent computed rollup even with a Person/Company split — especially for multi-subsidiary accounts. | **Low** | **New.** §CRM foundation, **P1** |
| E3 | **Commercial-field sync down the hierarchy** | `_commercial_fields`/`_synced_commercial_fields` (`:686`), `_commercial_sync_from_company`, `_commercial_sync_to_descendants`, `_fields_sync` (`:769`) | An explicit, declared list of fields (`vat`, `company_registry`, `industry_id`) that **belong to the commercial entity and are pushed to all descendants**, plus address fields that sync parent/child by `type`. It only writes children whose value actually differs. | **Low–Medium** | **New**, but caution: this is denormalisation-with-a-sync-hook, the exact pattern ERPNext §9 warns about. **Prefer a computed/inherited read** in SeaRM; take the *concept of a declared "owned by the account" field set*, not the write-propagation |

## Recommended additions to `CRM_CONSOLIDATION_PLAN.md`

From Odoo (**LGPL-3 — the one source where copying is legally viable; still reimplement, but flag it in the Phase-0 licence review**):

1. **§CRM foundation** — *Chatter as a mixin: message log + topic-typed followers/subtypes + auto-subscribe on assignment + per-recipient notification state* | Odoo `mail` | Port as an object-metadata capability | **P1**. Supersedes and extends handoff §4/§5/§7 (ever-gauzy) — Odoo's is the mature version of all three.
2. **§CRM foundation** — *Field tracking with typed diff rows, deleted-field survival, and field-ACL recheck at render time* | Odoo `mail.tracking.value` | Port | **P1**. Reference schema for the existing "Audit trail and field diffs" row.
3. **§CRM foundation** — *Commercial-entity rollup (`commercial_partner_id`): resolve any contact to its root account in one indexed computed field* | Odoo `res.partner` | Port | **P1**.
4. **§Sales** — *Rule-based lead assignment: per-team and per-member capacity plus declarative eligibility/preference domains, weighted-random allocation, dedupe-during-assign* | Odoo `crm.team`/`crm.team.member` | Port | **P1**. No assignment row exists in the plan today.
5. **§Sales** — *Merge with confidence-ranked winner, per-type field merge rules, and re-parented (not copied) history/followers/attachments* | Odoo `crm.lead._merge_*` | Port | **P1**. Best merge design scouted; attach to the existing dedupe/merge-review row.
6. **§AI-native** — *Naive-Bayes predictive scoring with per-(field,value) attribution and a human-override flag* | Odoo PLS | Port | **P1**. Explainable, non-LLM, and directly serves "an LLM confidence score is not evidence".
7. **§Sales** — *Inbound email alias that creates/updates records, with bounce mapping, three-layer loop protection, and global blacklist plus per-list opt-out* | Odoo `mail.thread` gateway + `mail.blacklist` | Port | **P1**. Plan covers connected accounts but not record-creating aliases or suppression.
8. **§CRM foundation** — *UTM attribution mixin (campaign/source/medium) auto-captured from request, find-or-create by name, skipped for internal users* | Odoo `utm` | Port | **P1**. Trivial cost, and it is the join key for all campaign ROI reporting.
9. **§Sales** — *Activities as scheduled intent, distinct from messages: deadline-derived state, type-driven delays, chaining (complete A then schedule B), and searchable `activity_state` on the record* | Odoo `mail.activity` | Port | **P1** (extends the existing tasks/reminders row); **activity plans P2**.
10. **§Installable solutions** — expand the campaigns row to *"…with a per-(mailing, recipient) trace lifecycle, send-time recipient dedup across the campaign, per-list opt-out with reasons, and A/B split with campaign-level winner selection (Odoo `mass_mailing` reference design)"* | **P2**.
11. **Supersede handoff §12 and the calendar half of ERPNext §6** with Odoo's *structured recurrence record + authored-timezone + per-attendee RSVP token*. Booking-link logic still comes from ERPNext (`FOR UPDATE` capacity check); **recurrence and timezone come from Odoo.**

## What I'd skip outright from Odoo

`crm`'s QWeb-bound views and kanban rainbowman/gamification (`_get_rainbowman_message`, `crm_lead.py:1181`); `digest` (its own reporting stack); `discuss` (a whole realtime chat product with WebRTC ICE servers, presence and push — `mail/models/discuss/`, `mail_ice_server.py`, `mail_push*.py` — out of scope unless you want in-app chat); `link_tracker` unless you take D2; `fetchmail` (IMAP polling — SeaRM already has connected accounts); and the entire `mail` client-side JS framework. Also skip `crm_lead`'s 2890-line single-class shape as a *structure* — the capabilities are excellent, the file is not a model to imitate.

**Scout note:** `mail/` is the strongest single subsystem encountered across all five scouted repos. If only one thing gets ported from Odoo, port the chatter — followers/subtypes, tracking values, activities, and the auto-subscribe rule — because handoff §4, §5, §6, §7 and §15 (ever-gauzy) and ERPNext §8 are all partial reinventions of it.

---

# From Frappe CRM and Helpdesk

**From:** an ERP-scout pass over `d:/Files/Vatsa/Projects/AI-CRM/frappe-crm` and `d:/Files/Vatsa/Projects/AI-CRM/frappe-helpdesk`. These are the two apps the Frappe team built *standalone* rather than extend their in-ERP modules — so they are the best available signal of that team's current thinking, and the ERPNext section above should be read as the legacy view.

## Licensing — read this first

- **Frappe CRM: AGPL-3.0** (`frappe-crm/LICENSE`). Same obligation class as ever-gauzy, Relaticle and SeaRM core.
- **Frappe Helpdesk: AGPL-3.0** (`frappe-helpdesk/`). Same.
- Neither is MIT. Everything marked "port" below means **reimplement from the described design against SeaRM's contracts** — do not copy files. Consistent with the plan's "capability port, not a Git merge".

---

## Part 1 — Frappe CRM (AGPL-3.0)

### F1. Lean lead/deal/organization split — DUPLICATE

- **Is:** `crm/fcrm/doctype/crm_lead|crm_deal|crm_organization|crm_task/*.json`. Lead = prospect; Deal = opportunity linking one org + many contacts; Organization carries website/employees/revenue/territory/industry.
- **Verdict:** **DUPLICATE.** Plan §CRM foundation ("People, companies, opportunities… / SeaRM / Keep / P0") and §Sales ("Multiple pipelines"). One design note worth keeping: they deliberately kept Lead and Organization as *independent* records rather than forcing a customer master — that is precisely why Frappe left ERPNext's CRM model behind. SeaRM's metadata already permits this.

### F2. Polymorphic activity timeline with dynamic reference — DUPLICATE (superseded by Odoo)

- **Is:** `frontend/src/components/Activities/Activities.vue` + `crm/api/activities.py`. Calls, emails, notes, tasks, comments, WhatsApp and status changes all reference the parent via `reference_doctype` + `reference_docname`.
- **Verdict:** **DUPLICATE** of handoff §7 (ever-gauzy) and superseded in quality by Odoo `mail`. Nothing new. Confirms the polymorphic-reference choice is the industry default.

### F3. Call Log as a first-class record, provider-agnostic — **PORT, new**

- **Is:** `crm/fcrm/doctype/crm_call_log/crm_call_log.json`, `crm/integrations/twilio`, `crm/integrations/exotel`. One `CRM Call Log` doctype: from/to, direction, full status enum (Initiated / Ringing / In Progress / Completed / Failed / Busy / No Answer / Queued / Canceled), start/end, duration, `recording_url`, caller + receiver user links, dynamic reference to lead/deal/anything. Two providers behind it; webhooks drive status transitions.
- **Why worth having:** the plan has "Call recording and meeting intelligence | SeaRM apps | Keep and expand" with no data contract. This supplies one: a provider-neutral call record with a *lifecycle enum*, which is what makes call analytics (connect rate, talk time, no-answer follow-up) possible at all. Recording URLs stay on the provider CDN — do the same, or storage cost scales with call volume.
- **Port cost:** Low for the record + webhook state machine; medium per provider adapter.
- **Verdict:** **new** — sharpen the existing plan row into a defined `CallLog` object plus a provider interface.

### F4. Metadata-driven filter/sort/group discovery API — **PORT the API shape, new**

- **Is:** `crm/api/doc.py` — `get_filterable_fields(doctype)`, `sort_options`, `get_group_by_fields` return field metadata so the UI builds filter/sort/kanban controls with zero per-object code. New fields become filterable automatically.
- **Why worth having:** SeaRM has the metadata; what the plan lacks is the *published discovery endpoint* over it. This is the same contract an MCP tool needs (Phase 4, "metadata discovery, scoped tools") — build it once, serve both the UI and the agent.
- **Port cost:** Low. Mostly exposure of what already exists.
- **Verdict:** **new as a plan row**; folds into §AI-native "MCP/OAuth connector" and Phase 4.

### F5. Per-user view settings as a record — DUPLICATE

- **Is:** `CRM View Settings` doctype; kanban column choice, filters, sorts and visible columns persisted per user via `updateKanbanSettings`.
- **Verdict:** **DUPLICATE.** Plan §CRM foundation "Table, board, calendar, dashboard, and record views / SeaRM / Keep / P0".

### F6. Runtime form scripts (low-code customisation without deploy) — **PORT the idea, P2**

- **Is:** `crm/fcrm/doctype/crm_form_script/`, `crm/api/form.py`, consumed in `frontend/src/pages/Lead.vue`. Per-object JS with `on_load` / `before_save` / `on_save` hooks that can hide fields, set values and inject custom action buttons — executed in the browser, not on the server.
- **Why worth having:** it is the escape hatch that keeps a vertical customer (an Indian manufacturing SME) off a fork. SeaRM's answer is apps + workflow code functions, which is heavy for "hide this field when stage = X".
- **Port cost:** Medium-high, and it is mostly a *security* cost: tenant-authored JS needs a sandbox and a permission gate. Client-side-only execution (as Frappe does here) is the cheap safe version — it can never bypass server permissions.
- **Verdict:** **new**, but P2 and explicitly scoped to client-side presentation logic only.

### F7. Domain enrichment via offline Public Suffix List + scrape — take the idea

- **Is:** `crm/domain_enrichment/`, `EnrichFromWebsite.vue`; `tldextract` + BeautifulSoup pull company description, social URLs and `og:image` logo from the org's own website, async, into the record.
- **Why worth having:** the plan's "Company/person enrichment providers" row assumes paid providers. A zero-cost self-hosted provider is a sane default tier for SMEs and needs no vendor contract.
- **Verdict:** **partly DUPLICATE** — implement as one more provider behind the existing provider interface. New only as a *tier-zero* default. Per the plan's own rule, scraped values are evidence, not facts.

### F8. Permission enforcement at the query layer — DUPLICATE

- **Is:** `crm/permissions/org_hierarchy.py` + `permission_query_conditions` hooks — visibility is a WHERE clause, not UI hiding, plus `has_permission` for document-level checks.
- **Verdict:** **DUPLICATE.** Plan §Team "Roles, permissions, field access / Keep and enforce for every AI/tool path / P0". Corroboration for that P0, nothing more.

### F9. Pinia + `createResource` client cache — see the cross-cutting note below.

---

## Part 2 — Frappe Helpdesk (AGPL-3.0)

### H1. Ticket status *categories* driving SLA mechanics — **PORT, new**

- **Is:** `helpdesk/helpdesk/doctype/hd_ticket_status/hd_ticket_status.json` — each user-defined status maps to a category of Open / Paused / Resolved. The category, not the status name, decides whether the SLA clock runs, pauses or stops.
- **Why worth having:** a tenant can invent statuses ("Awaiting Parts", "With QA") without touching SLA code. This is the indirection most homegrown ticket schemas miss.
- **Port cost:** Low — one enum on the status metadata.
- **Verdict:** **new.** Attach to §Installable solutions "Customer support tickets… SLA / crmkit / App / P2".

### H2. SLA selection by rank + condition + default fallback — **PORT, supersedes ERPNext §7**

- **Is:** `hd_service_level_agreement/utils.py` and `hd_ticket.py`. Enabled SLAs ordered by rank (0 = unranked, sorted last); each carries a Python condition or a portal-built JSON filter; the ticket priority must appear in the SLA's priority list; the default SLA is always evaluated last. Working hours from `HD Service Day`, non-working days from `HD Service Holiday List`. Tracks `response_by` / `resolution_by`, agreement status (First Response Due → Resolution Due → Fulfilled / Failed / Paused) and accumulates `total_hold_time` while paused.
- **Why worth having:** handoff ERPNext §7 already recommends porting an SLA engine; **this is the better version of the same design** — deterministic multi-policy selection plus hold-time accounting. Take this one, drop the ERPNext variant.
- **Port cost:** Medium. The hard parts are the working-hours calendar and pause accounting, not the selection.
- **Verdict:** **supersedes ERPNext §7.** Also note: the plan's workflow 4 step 3 ("SLA timers create warnings/escalations") currently has no engine behind it.

### H3. Email→ticket thread stitching with `References` fallback — **PORT, new, best code in Helpdesk**

- **Is:** `helpdesk/overrides/email_account.py`. Two-stage parent lookup: standard `In-Reply-To` matched against Communication *and* EmailQueue, then a fallback that walks every message-id in the `References` header. Filters `X-Auto-Generated` mail so autoresponders never open tickets. Bad emails are logged, not fatal.
- **Why worth having:** the plan has connected accounts and (via Odoo §7) a record-creating inbound alias, but no thread-reattachment rule. Forwarded and client-mangled chains break `In-Reply-To` constantly; the References walk is the fix, and checking the *outbound queue* as well as received Communications is what makes two-way threading work.
- **Port cost:** Low-medium. Pairs directly with Odoo's mail gateway + loop protection — port them together.
- **Verdict:** **new.**

### H4. Team pool assignment with membership-consistency cleanup — **PORT the small part**

- **Is:** `hd_team`, `hd_agent`, `helpdesk/api/assignment_rule.py`. Tickets carry `agent_group` (team); assignment runs through Frappe's Assignment Rule; on update, an assignee no longer in the ticket's team is **automatically unassigned**; agent availability is a tracked status (`HD Agent Status`).
- **Why worth having:** Odoo §4 already gives the superior *allocation* algorithm (capacity + eligibility domains + weighted random). Frappe adds the boring correctness rule Odoo's section doesn't mention: reconcile assignments when team membership changes, or you accumulate tickets assigned to people who left the queue.
- **Verdict:** **mostly DUPLICATE of Odoo §4**; take only the membership-reconciliation rule and the agent-availability flag.

### H5. Customer portal: UUID share key + write-lock on closed/rated — **PORT, new, cheap**

- **Is:** `hd_ticket.py`, `helpdesk/web_form/tickets/tickets.py`. Every ticket has a UUID `key` enabling link-based access without an account; feedback is collected by emailed link at `/ticket-feedback/new?key=…`, auto-triggered on a configurable status change; non-agents cannot modify a Closed or already-rated ticket.
- **Why worth having:** handoff §11 (ever-gauzy) already recommends the "public acceptance via token" pattern for quotes; this is the same primitive for a second use case, plus the readonly-after-terminal rule that stops customers re-litigating closed records.
- **Port cost:** Low. Generalise §11's token into one shared "public record link" primitive and reuse it for quotes, feedback and booking.
- **Verdict:** **new as a generalisation**; the token half is DUPLICATE of §11.

### H6. Denormalised response-time metrics on the record — **PORT, new, trivial**

- **Is:** the ticket stores `first_responded_on`, `last_agent_response`, `last_customer_response` and derives `first_response_time` / `avg_response_time`. `HD Ticket Activity` separately logs discrete field changes (status, priority, team, type, SLA) with user and timestamp.
- **Why worth having:** the activity log is DUPLICATE (Odoo tracking values are better). The *denormalised timestamps* are not — they make "tickets breaching first response" a cheap indexed query instead of a timeline scan. Same trick applies to the plan's "Outreach count and last-outreach signals | crmkit | computed fields" row.
- **Verdict:** **new**; fold into that existing computed-signals row.

### H7. Knowledge base — take the idea, low priority

- **Is:** `hd_article` (title, content, category, Published/Draft/Archived, author, view counter) + `hd_article_category` + article feedback.
- **Gap:** no versioning, no approval workflow. Fine for FAQ, unusable for controlled documentation.
- **Verdict:** **new but P3.** Only worth building if the support app ships.

### H8. Bidirectional Customer sync with ERPNext — take the hook checklist only

- **Is:** `helpdesk/integrations/erpnext/customer.py` + `hooks.py` — `after_insert`, `on_update`, `before_rename`, `after_rename`, `on_trash`, plus User Permission and DocShare sync.
- **Why worth having:** the *rename* and *permission-share* hooks are the two everyone forgets when building a sync. Keep as a checklist for any SeaRM↔external-system sync.
- **Verdict:** **DUPLICATE-adjacent** — a note, not a port.

### H9. ERP GAP — Helpdesk is **not** a complaint / warranty / quality system

- Frappe Helpdesk has no RMA, no warranty-period enforcement, no serial/batch linkage, no defect or failure-mode tracking, no link to work orders or quality inspections, no recall workflow, and no approval gate for high-value claims.
- **Why this matters here:** for the Indian-manufacturing-SME MVP, a "customer complaint" is an ERP workflow (traceable to a batch, a work order, a warranty term), not a support ticket. Do **not** let the support app in §Installable solutions be mistaken for complaint management — scope it as support only, and record complaint / warranty / RMA as a separate ERP-side gap.
- **Verdict:** **new — a gap flag, not a port.** The most consequential line in this section.

---

## Cross-cutting: the frontend architecture observation

Both apps are **Vue 3 SPAs served beside** the Frappe backend rather than inside it — separate Vite build (`frontend/`, `desk/`), own router base (`/crm`), own component library (`frappe-ui`), Pinia stores, socket.io for push, mobile/desktop layout swap at a 640px breakpoint. SeaRM's stack is React / NestJS / GraphQL, so none of this ports directly. The transferable lesson is about **API shape, not framework**:

1. **The SPA only ever talks to the backend through the same public, whitelisted API a third party would use** — `@frappe.whitelist()` → `/api/method/crm.api.*`, type-annotated and enforced by `require_type_annotated_api_methods` in `hooks.py`. There is no privileged internal channel. That constraint is *why* the metadata discovery endpoints in F4 exist at all: the UI needed them, so agents get them free. **Recommendation for the SeaRM port: hold every AI/MCP tool path to the same API the UI uses.** If the UI needs a private endpoint, the agent will eventually need it too.
2. **Client-side resource declarations (`createResource` + Pinia) keep `url`, `cache` key, `transform` and `onError` next to each other**, so a UI consumer and an agent consumer of the same endpoint cannot drift in how they normalise the response. SeaRM has its own caching; the co-location is the part worth copying.
3. **Push over poll.** socket.io authenticated by the ordinary session cookie, emitted server-side from doctype change hooks (`helpdesk:ticket-update`). Nothing new for SeaRM, but it confirms record-change events should be emitted from the persistence layer, not from each feature.

## Recommended additions to `CRM_CONSOLIDATION_PLAN.md`

From Frappe CRM and Helpdesk (**both AGPL-3.0 — design-level port only; add to the Phase-0 licence review alongside ever-gauzy and Relaticle**):

1. **§Installable solutions** — rewrite the support row as *"Support tickets with status→SLA-category indirection, rank+condition+default SLA selection, working-hours and holiday calendars, hold-time accounting, and denormalised first/last response timestamps (Frappe Helpdesk reference design)"* | **P2**. **Supersedes handoff ERPNext §7** — take Helpdesk's SLA engine, not ERPNext's.
2. **§Sales** — *Provider-neutral `CallLog` object: direction, full status lifecycle enum, duration, externally-hosted recording URL, caller/receiver principals, polymorphic record reference; providers behind one adapter interface* | Frappe CRM `CRM Call Log` | Port; sharpens the existing "Call recording and meeting intelligence" row | **P1**.
3. **§AI-native / Phase 4** — *Published metadata discovery endpoints (filterable fields, sort options, group-by fields) serving the UI and the MCP tool layer from one contract; no privileged internal API path* | Frappe `crm/api/doc.py` | Port | **P1**.
4. **§Sales** — extend the inbound-mail row (Odoo §7) with *`References`-header thread reattachment, message-id lookup across both received Communications and the outbound queue, and `X-Auto-Generated` filtering* | Frappe Helpdesk `overrides/email_account.py` | Port together with the Odoo gateway | **P1**.
5. **§CRM foundation** — *Public record link primitive: UUID share key + scoped action + write-lock once the record reaches a terminal state*, generalising handoff §11's quote-acceptance token to feedback, quotes and booking | **P2**.
6. **§Sales** — extend "Outreach count and last-outreach signals" with *denormalised first-response / last-inbound / last-outbound timestamps on the record*, so breach and staleness queries stay indexed | **P1**.
7. **§Sales** — add to the assignment row (Odoo §4) *reconcile-assignments-on-team-membership-change, plus an agent availability status* | **P1**, small.
8. **§CRM foundation** — *Client-side form scripts (presentation logic only: field visibility, defaults, custom actions), sandboxed and permission-gated, structurally unable to bypass server checks* | Frappe `CRM Form Script` | **P2**.
9. **§AI-native** — add *self-hosted website/domain enrichment (Public Suffix List + scrape → description, socials, logo)* as the zero-cost default tier behind the existing enrichment-provider interface; its output is evidence, not fact | **P2**.
10. **§Risks and boundaries** — **new boundary statement:** *support ticketing is not complaint, warranty, RMA or quality management.* Field complaints for a manufacturing SME need batch/serial traceability, warranty-period enforcement, failure-mode capture, escalation into work orders or quality inspections, and an approval gate for high-value claims. Frappe Helpdesk has none of these, and neither will the support app. Track as a separate ERP-side workstream.

## What I'd skip outright from Frappe CRM and Helpdesk

The entire Vue / `frappe-ui` / Tiptap frontend (wrong stack, and SeaRM's UI is stronger); the WhatsApp integration as built (a thin wrapper over Frappe's core WhatsApp app — treat WhatsApp as one more channel adapter, not a feature); the Docker/bench deployment layer; the doctype/child-table modelling idiom itself (SeaRM's metadata layer is the equivalent and better); Frappe's Assignment Rule framework (Odoo §4's allocation model is the one to build); and `HD Article` unless the support app ships.
