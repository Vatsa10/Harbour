# crmkit Scouting Report

Source: `d:/Files/Vatsa/Projects/AI-CRM/crmkit` (Go, ~19k LOC, SQLite/PostgreSQL dual dialect, HTTP + MCP).
Governed by `d:/Files/Vatsa/Projects/AI-CRM/docs/superpowers/PRODUCT-CHARTER.md`. Per the charter, crmkit's adopted
capability is: **agent-safe errors, OAuth/MCP access, deterministic API semantics, ticket/campaign workflow models.**
This document is a complete design inventory — every capability found, ranked, and given exactly one disposition
(BUILD NOW or DEFER). Nothing is dropped silently. We are extracting *design*, not porting Go code: SeaRM is
TypeScript/NestJS/GraphQL, multi-tenant, metadata-driven — the reimplementation must fit that shape, not crmkit's.

---

## 0. What crmkit is, in one paragraph

crmkit is a single-tenant-per-workspace, agent-first CRM API server. Its defining bet: **the primary client is an
LLM, not a browser**, so every design decision — plain-text-by-default responses, short opaque handles instead of
UUIDs, deterministic upsert semantics, confirmation tokens instead of "are you sure" dialogs, instructive errors
that tell the model exactly what call to make next — optimizes for an agent driving the API through a single
generic MCP tool that replays raw HTTP calls. It has no UI. Everything is HTTP + MCP + SQL.

Files referenced throughout use paths relative to the repo root.

**Deepening pass (2026-08-16) — source-deletion readiness.** Sections 1.1–1.18 were re-derived from the Go
source and now carry the **literal request and response shapes**, the complete closed vocabularies (error codes,
audit verbs, filter whitelists, operator map, allowlists), and the exact algorithms (confirm-token hash,
`expectedVersion` precedence, cursor codec, handle codec) rather than prose descriptions of them. Every row —
BUILD NOW and DEFER alike — is rebuildable from this document alone. §1.19 needs nothing: it is a permanent
architectural no with nothing to reimplement. Three fidelity corrections surfaced during the pass and are marked
inline where they occur: **(a)** `/tickets` is absent from the MCP tool allowlist, so crmkit's ticket model was
never actually exercised by an agent (§1.14); **(b)** the confirm token is a deterministic hash of a *known* id
and is therefore a fat-finger guard, not an authorization control (§1.2); **(c)** upserts bypass both the plan
quota and the optimistic-concurrency check (§1.5). crmkit's source repo can be deleted after this pass.

---

## 1. RANKED INVENTORY — every capability worth having

Ranked by value to the charter's non-negotiable contracts (Execution, Proposal, Principal) and the "agent access"
target capabilities. Each entry: wire format, control flow, the decision worth keeping, and disposition.

### 1.1 Agent-safe error envelope (rank: HIGHEST — directly named in charter)

**File:** `internal/render/render.go` (`Error`, `errorBody`), used from every handler in `internal/server/handlers_*.go`.

**Wire format (JSON, when `Accept: application/json` or `?format=json`):**
```json
{ "error": "version_conflict", "hint": "This contact changed since you last read it. GET it again, re-apply your change onto the current version, then retry." }
```
**Wire format (plain text, the agent-facing default):**
```
ERROR version_conflict
HINT  This contact changed since you last read it. GET it again, re-apply your change onto the current version, then retry.
```

**Control flow:** `render.Error(w, r, status, code, hint)` is the single choke point every handler calls on failure.
`code` is a short stable machine token (`not_found`, `bad_request`, `missing_field`, `invalid_field`,
`invalid_filter`, `invalid_value`, `invalid_cursor`, `invalid_sort`, `version_conflict`, `confirmation_required`,
`ambiguous_match`, `plan_limit_reached`, `escalation_required`, `invalid_code`, `last_admin`, `server_error`).
`hint` is always a full imperative sentence telling the model **the next tool call to make**, not just what went
wrong. Examples actually in the code:
- 404: `"No contact with that id in your workspace. List them first (GET /contacts) to find the right handle."` (`handlers_crm.go:47`)
- 412 optimistic-concurrency conflict: `"...GET it again, re-apply your change onto the current version, then retry."` (`handlers_crm.go:152`)
- 409 destructive-action confirmation: `"Deleting contact_k7m2q is irreversible. Confirm with the user, then repeat with ?confirm=<token>."` (`handlers_crm.go:40`)
- 409 duplicate on upsert key collision: `"Multiple contacts already have email X. Resolve the duplicates, or update one directly by its id."` (`handlers_crm.go:335`)
- 400 unknown filter: `"unknown filter field X; filter by: <sorted whitelist>"` (`query.go:157`)

**Complete code → status → hint table (verbatim from source; this is the whole vocabulary — nothing else exists).**
Recorded in full so the envelope is rebuildable without the Go source. Codes marked *(query layer)* are minted by
`queryError{code,hint}` in `internal/server/query.go` and all surface as **400** through `writeQueryError`.

| Code | HTTP | Hint text (exact) |
|---|---|---|
| `not_found` | 404 | `No <kind> with that id in your workspace. List them first (GET /<kind>s) to find the right handle.` |
| `bad_request` | 400 | Per-endpoint; always shows a literal example body, e.g. `Send JSON, e.g. {"name":"Jane Doe","email":"jane@acme.com","company_id":"company_..."}.` / `Send a JSON object with only the fields you want to change, e.g. {"status":"solved"}.` |
| `missing_field` | 400 | `"name" is required to create a contact.` (same shape per entity: `"subject"` for tickets, `"body"` for activities) |
| `invalid_field` | 400 | `"status" must be one of: open, pending, solved.` / `"status" must be one of: active, paused, done.` / `"kind" must be "contact" or "company".` / `"campaign" did not match a campaign in your workspace. Create it first, then attach.` |
| `invalid_filter` *(query layer)* | 400 | `unknown filter field <f>; filter by: <sorted, comma-joined whitelist>` — also `this resource has no custom fields to filter on.`, `custom field key must be letters, digits, or underscore, e.g. custom.region.`, `on_behalf_of is not filterable on this resource` |
| `invalid_sort` *(query layer)* | 400 | `sort= must be one of: <sorted whitelist> (prefix with - for descending)` |
| `invalid_cursor` *(query layer)* | 400 | `The cursor is malformed. Omit it to start from the first page.` |
| `invalid_value` *(query layer)* | 400 | `<column> expects an integer` / `<column> expects an RFC3339 timestamp like 2026-01-31T00:00:00Z` / `<column>=is: only supports null (use is:null)` / `on_behalf_of needs a value, e.g. ?on_behalf_of=alice@acme.com` |
| `invalid_op` *(query layer)* | 400 | `like is only valid on text fields` |
| `missing_query` | 400 | search called with no `q` |
| `invalid_email` | 400 | login/invite with an unparseable address |
| `invalid_role` | 400 | `role must be "admin" or "member".` |
| `invalid_timezone` | 400 | workspace timezone is not an IANA name |
| `version_conflict` | **412** | `This <kind> changed since you last read it. GET it again, re-apply your change onto the current version, then retry.` |
| `confirmation_required` | **409** | `Deleting <agent's own ref> is irreversible. Confirm with the user, then repeat with ?confirm=<8 hex chars>` |
| `ambiguous_match` | **409** | `Multiple contacts already have email <e>. Resolve the duplicates, or update one directly by its id.` (companies: `...have domain <d>...`) |
| `last_admin` | 409 | `You can't demote the last admin. Promote someone else first.` |
| `plan_limit_reached` | **403** | `Plan "<plan>" allows at most <N> <resource> (currently <M>). Ask a workspace admin to raise the limit or change the plan.` |
| `escalation_required` | **403** | `This action (<desc>) needs email confirmation. A code was sent to <email>. Ask the user for it, then repeat this exact request with ?code=<code>.` |
| `invalid_code` | 403 / 401 | `That confirmation code is wrong or expired. Repeat the request with no code to get a fresh one.` |
| `admin_required` | 403 | caller is not an admin of the workspace |
| `not_a_member` | 403 | token's user is not a member of the addressed workspace |
| `auth_required` | 401 | no bearer presented |
| `invalid_token` / `token_expired` | 401 | bearer unknown / past its idle window |
| `rate_limited` | 429 | login/OTP throttle |
| `email_failed` | 500 | outbound mail send failed |
| `server_error` | 500 | `Try again shortly.` |
| `not_ready` | 503 | health probe, store not up |

**The OAuth endpoints do NOT use this envelope.** `/oauth/*` writes the RFC 6749 shape instead
(`internal/server/handlers_oauth.go:50`), always JSON, always `Cache-Control: no-store`:
```json
{ "error": "invalid_grant", "error_description": "PKCE verification failed." }
```
with codes `invalid_client_metadata`, `invalid_redirect_uri`, `invalid_request`, `invalid_grant`,
`unsupported_grant_type`, `server_error`. Two error dialects in one server, split by plane — worth copying as a
deliberate choice (standards compliance wins on the standards-defined surface), not an inconsistency.

**Exact Go source of the envelope** (`internal/render/render.go:50-73`) — the whole thing:
```go
type errorBody struct {
    Error string `json:"error"`
    Hint  string `json:"hint,omitempty"`
}

func Error(w http.ResponseWriter, r *http.Request, status int, code, hint string) {
    if WantJSON(r) { /* status + {"error":code,"hint":hint} */ }
    w.WriteHeader(status)
    fmt.Fprintf(&b, "ERROR %s\n", code)
    if hint != "" { fmt.Fprintf(&b, "HINT  %s\n", hint) }   // two spaces after HINT
}
```
Note the text form repeats nothing about the status line: `ERROR <code>\n` then `HINT  <hint>\n` (two spaces, so
`ERROR`/`HINT` column-align). The comment states the reason: "In text mode the status code appears in the body too,
so agents that only see the body still learn what happened."

**The specific decision worth keeping:** the error is not "code + message" (that's just HTTP). It is **code +
message + a literal instruction for recovery**, and the instruction is concrete enough to paste back as the next
call (`GET /contacts`, `?confirm=<token>`, `?cursor=`). This is exactly the charter's target shape
(`code, message, hint, allowed_actions, retryable`), missing only explicit `allowed_actions`/`retryable` fields —
those are implied by the hint text today but not machine-typed.

**What to build instead (target shape for SeaRM, since we're not porting Go):**
```json
{
  "error": {
    "code": "RECORD_VERSION_CONFLICT",
    "message": "This record changed since you last read it.",
    "hint": "Re-fetch the record, reapply your change onto the current version, then retry.",
    "retryable": true,
    "allowedActions": ["refetch", "retry"]
  }
}
```
Apply crmkit's pattern (stable code + human message + imperative hint) to SeaRM's GraphQL error `extensions` and
to the REST/MCP error body; add the two missing structured fields (`retryable: boolean`, `allowedActions: string[]`)
so a model can branch programmatically instead of parsing English.

**Disposition: BUILD NOW.** This is the cheapest, highest-leverage single capability in the whole audit — it's a
formatting convention plus a lookup table, applicable across every existing SeaRM resolver/controller. Directly
required by charter section "Metadata-aware AI and MCP tools: Return machine-readable failures."

---

### 1.2 Confirmation-token semantics for destructive actions (rank: HIGH — named in charter)

**File:** `internal/server/handlers_crm.go:19-43` (`confirmToken`, `requireConfirm`).

**Wire format:** `DELETE /contacts/c_ab12` with no `?confirm=` returns **409**:
```
ERROR confirmation_required
HINT  Deleting contact_ab12 is irreversible. Confirm with the user, then repeat with ?confirm=8f3a91c2
```
Repeating `DELETE /contacts/c_ab12?confirm=8f3a91c2` succeeds with **200** and the body:
```
OK deleted contact_ab12
```
(`render.Text` → JSON mode gives `{"message":"OK deleted contact_ab12"}`; the echoed ref is `r.PathValue("id")`,
i.e. **whatever string the caller typed**, not a re-canonicalized form.)

**Exact token derivation** (`handlers_crm.go:19-24`, reproduce this literally or tokens won't match):
```go
func confirmToken(id string) string {
    sum := sha256.Sum256([]byte("crmkit:delete:" + id))
    return hex.EncodeToString(sum[:])[:8]     // first 8 lowercase hex chars
}
```
The gate (`handlers_crm.go:31-43`) is a plain string compare of `strings.TrimSpace(r.URL.Query().Get("confirm"))`
against that value — no header alternative, no TTL, no storage, no per-user binding. **Security property to
understand before copying:** the token is a pure function of the record id and a hardcoded literal, so it is
*guessable by anyone who can compute SHA-256 over an id they already know*. It is a **fat-finger guard, not an
authorization control** — it proves the caller made two deliberate calls, nothing more. crmkit is explicit that
real authority is the bearer token; do not let this pattern stand in for approval.

**Exactly six endpoints gate on it** (verified by grep for `requireConfirm(`): delete contact
(`handlers_crm.go:452`), company (`:782`), deal (`:913`), ticket (`:1115`), task (`:1266`), campaign
(`handlers_campaign.go:137`). Everything else that deletes does not.

**Control flow / the clever part:** the token is **stateless and deterministic**: `sha256("crmkit:delete:" + id)[:8]`
(hex). No confirmation record is written to storage, no TTL to expire, no DB round-trip to verify — the server just
recomputes the hash and compares. It is keyed on the **durable internal id** (stable regardless of which handle
alias the agent used to address the record), but the hint echoes back the **agent's own reference string** (the
short handle it used in the path) so the message reads naturally without extra lookups. Every destructive endpoint
(`handleDeleteContact/Company/Deal/Ticket/Task/Campaign`) calls the identical `requireConfirm` gate.

One exception, worth noting as a deliberate distinct decision: `handleDeleteActivity` (`handlers_crm.go:1324`)
skips confirmation entirely — activities are treated as low-stakes append-only log lines you may want to prune in
bulk, so forcing a confirm round-trip per line would be friction with no safety benefit. This is a **graduated
destructiveness** design: not every DELETE gets the same ceremony.

**Disposition: BUILD NOW**, but note the charter already assigns proposal/approval to be the *human* gate for AI
mutations. crmkit's confirm-token is a *protocol-level* two-step (call, see cost, call again) distinct from and
complementary to SeaRM's `Proposal`/`ProposalItem` approval flow. Recommendation: keep both layers — the
Proposal contract governs whether an AI-originated delete may execute at all (needs human approval); the
confirmation-token pattern is the right shape for the **synchronous MCP tool contract itself** (any tool call that
resolves to a destructive REST verb) so a model can't fat-finger a delete in one shot even before the record ever
reaches a Proposal. Also worth the "graduated destructiveness" idea: not all deletes need the same weight.

---

### 1.3 Email step-up escalation for high-risk non-CRUD actions (rank: HIGH — not explicitly named in charter but clearly load-bearing)

**File:** `internal/server/handlers_escalation.go`.

**Wire format:** first call, no code:
```
ERROR escalation_required
HINT  This action (promote a member to admin) needs email confirmation. A code was sent to alice@acme.com. Ask the user for it, then repeat this exact request with ?code=<code>.
```
Second call: `PATCH /workspaces/{id}/members/{userId}/role?code=482913` with `{"role":"admin"}` — succeeds if the
code matches and is unexpired, responding **200** with `OK member/<userId> role=admin`.

**Complete wire trace, both gated actions** (`handlers_escalation.go`):
```
# --- action 1: promote to admin (only when the new role is "admin"; demotion is not gated) ---
PATCH /workspaces/ws_123/members/u_456/role
Content-Type: application/json
{"role":"admin"}
-> 403
ERROR escalation_required
HINT  This action (promote a member to admin) needs email confirmation. A code was sent to alice@acme.com. Ask the user for it, then repeat this exact request with ?code=<code>.

PATCH /workspaces/ws_123/members/u_456/role?code=482913     {"role":"admin"}
-> 200   OK member/u_456 role=admin
   (audit: action=member.role target=workspace/ws_123 detail="u_456=admin")

# --- action 2: destroy a workspace ---
DELETE /workspaces/ws_123
-> 403 escalation_required, desc = "delete this workspace and all its data"
DELETE /workspaces/ws_123?code=482913
-> 200   OK deleted workspace/ws_123 and all its data
```
The code may also be sent as the header `X-Escalation-Code: 482913` instead of `?code=` (`stepUpCode`,
`handlers_escalation.go:27-32`) — same liberal-input-channel instinct as `If-Match`-or-body in §1.4.
A wrong/expired code returns **403 `invalid_code`** with hint `That confirmation code is wrong or expired. Repeat
the request with no code to get a fresh one.` In local/dev mode the hint has ` (local code: NNNNNN)` appended and
the code is also logged — a deliberate dev affordance, and an obvious thing **not** to port.

**Control flow:** `requireEscalation(sess, action, target, desc)` — the challenge is bound to
`(userID, action, target)` via `auth.HashStepUp(secret, userID, action, target, code)`, so a code minted for
"promote alice" cannot authorize "delete workspace." TTL default 10 minutes (`escalationTTL`). Applied to exactly
two actions in the codebase: promoting a member to admin (`member.promote`), and deleting an entire workspace
(`workspace.delete`) — i.e., actions that are catastrophic and infrequent, distinct from ordinary record CRUD
which uses the (cheaper) confirm-token pattern above.

**The specific decision worth keeping:** a **third tier of friction**, above delete-confirm, reserved for
workspace-destroying or privilege-escalating actions — implemented as an actual out-of-band channel (email),
not just a repeat-the-call token, because those actions must not be confirmable by the same channel that
requested them (an MCP client with a stolen bearer token can echo back a `?confirm=` token trivially, but it
can't read the admin's inbox).

**Disposition: BUILD NOW** as a design pattern, mapped onto SeaRM's existing SSO/session model: for the two
classes of action SeaRM already has analogues for (role escalation, workspace deletion), require a second-factor
confirmation channel (email code, or reuse SeaRM's existing MFA if present) rather than a single bearer-token
call. This is squarely inside the charter's Principal contract territory — distinguishing "this user, right now,
freshly re-verified" from "a request bearing this user's token."

---

### 1.4 Optimistic concurrency via `version` + conditional PATCH (rank: HIGH — deterministic API semantics)

**Files:** `internal/protocol/protocol.go` (`Version int64` field on every mutable entity), `internal/server/handlers_crm.go:127-160` (`expectedVersion`, `writeUpdateErr`).

**Wire format:** every entity read returns `"version": 7`. A PATCH is made conditional by echoing it back either
as the `If-Match` header (`If-Match: "7"`) **or** as `"version": 7` in the JSON body — the server tries the header
first, falls back to the body, so agents can use whichever channel the client library makes easiest. Omitting
`version` entirely means "last write wins" (`expectedVersion` returns 0, `store.UpdateX` treats 0 as no-check).
A stale version yields **412 Precondition Failed** with `version_conflict` (see §1.1).

**Exact precedence rule** (`handlers_crm.go:127-142`) — reproduce literally:
```go
func expectedVersion(r *http.Request, body []byte) int64 {
    if m := strings.Trim(r.Header.Get("If-Match"), `" `); m != "" && m != "*" {
        if n, err := strconv.ParseInt(m, 10, 64); err == nil { return n }
    }
    var probe struct{ Version int64 `json:"version"` }
    _ = json.Unmarshal(body, &probe)
    return probe.Version      // 0 == "no check, last write wins"
}
```
Notes that matter for a reimplementation: quotes **and** spaces are stripped, so `If-Match: "7"`, `If-Match: 7`
and `If-Match: " 7 "` are equivalent; `If-Match: *` is explicitly treated as *no* precondition (not "must exist");
a malformed `If-Match` silently falls through to the body rather than erroring; and the body probe is a *second*
unmarshal of the raw bytes, so the handler must have read the body once into a `[]byte` before decoding
(every mutating handler does `body, _ := readBody(r)` then `decodeBytes(body, &entity)` then
`expectedVersion(r, body)` — that ordering is load-bearing).

**Full round trip:**
```
GET /contacts/c_ab12
-> 200
   handle:   contact_ab12
   version:  7
   name:     Jane Doe
   ...
   (JSON: {"id":"c_...","handle":"ab12x","version":7,"name":"Jane Doe",...})

PATCH /contacts/c_ab12                    PATCH /contacts/c_ab12
If-Match: "7"                     OR      {"stage":"customer","version":7}
{"stage":"customer"}
-> 200, body is the full updated record with "version": 8

# stale:
PATCH /contacts/c_ab12   If-Match: "7"    (record is now at 9)
-> 412
ERROR version_conflict
HINT  This contact changed since you last read it. GET it again, re-apply your change onto the current version, then retry.
```
`version` is emitted with `json:"version,omitempty"`, so a record at version 0 omits the field entirely — a
reimplementation must not let "field absent" mean "no concurrency control available."

**Which entities carry it:** `Contact`, `Company`, `Deal`, `Ticket`, `Task`, `Campaign` (every mutable entity).
**`Activity` deliberately does not** — it is an append-only log line with no PATCH endpoint.

**Control flow:** the store layer's `UpdateContact(ws, &c, expectedVersion)` does `UPDATE ... WHERE id=? AND
version=?` (compare-and-swap at the SQL layer, not read-then-write in application code — no race window), returning
`ErrConflict` when zero rows were affected because the version had moved.

**Disposition: BUILD NOW.** This is exactly what an agent needs to safely read-modify-write without last-write-wins
data loss, and SeaRM's GraphQL mutations do not currently expose a version-guard at the API surface (SeaRM has
soft-delete/audit but optimistic concurrency for concurrent-agent-and-human edits is not the same thing). Map to
SeaRM as: expose `updatedAt` or a monotonic `version` field on core objects' generated GraphQL types, accept it as
an optional mutation argument, translate a mismatch into the error envelope from §1.1 with `code: RECORD_VERSION_CONFLICT`.
Directly serves the charter's Execution contract ("idempotent... retryable") for the *agent* write path in particular
(concurrent human-edits-while-agent-drafts is the exact scenario the Proposal contract exists to gate, but once a
Proposal is *approved* and about to write, the underlying record could have moved — this is the guard for that window).

---

### 1.5 Deterministic idempotent-create via upsert-on-natural-key (rank: HIGH — deterministic API semantics, directly prevents duplicate creation which is a named charter workflow step: "Deterministic email/domain/relationship matching prevents duplicates")

**File:** `internal/server/handlers_crm.go:300-377` (`handleCreateContact`), `:642-711` (`handleCreateCompany`).

**Wire format:** `POST /contacts {"name":"Jane","email":"jane@acme.com"}` — if a contact with that email
(case-insensitive) already exists in the workspace, the server **merges the provided fields onto the existing
record and updates it** instead of creating a duplicate, and responds `200 OK` with a trailer:
```
contact/c_ab12  name="Jane Doe" email="jane@acme.com" ...
# updated
```
vs. a genuine create responding `201 Created` with `# created`. If **more than one** existing contact matches the
key (a state that shouldn't normally arise but can from historic dirty data), the server refuses to guess and
returns **409 `ambiguous_match`**: `"Multiple contacts already have email X. Resolve the duplicates, or update one
directly by its id."` — pushing disambiguation back to the human/agent instead of silently picking one.

**Exact request/response, all three outcomes** (`handleCreateContact`, `handlers_crm.go:300-377`):
```
POST /contacts
{"name":"Jane Doe","email":"jane@acme.com","company_id":"company_9xk2p","stage":"lead"}

# (a) no existing contact with that email  -> 201 Created
contact_ab12  name="Jane Doe" email=jane@acme.com company=Acme stage=lead updated=2026-08-05T10:03Z
# created
   JSON: the full Contact object, status 201. Audit: contact.create

# (b) exactly one existing match           -> 200 OK
contact_ab12  name="Jane Doe" email=jane@acme.com ...
# updated
   JSON: the full merged Contact object, status 200. Audit: contact.upsert  detail="updated"

# (c) two or more existing matches         -> 409
ERROR ambiguous_match
HINT  Multiple contacts already have email jane@acme.com. Resolve the duplicates, or update one directly by its id.
```
`# created` / `# updated` is appended to the **plain-text body only**; in JSON mode the two cases are
distinguishable solely by HTTP status (201 vs 200). A reimplementation on a typed transport must surface that
create-vs-update discriminator explicitly in the payload.

**The merge, step by step** (order is load-bearing):
1. `readBody` once into `[]byte`; decode into a fresh entity; reject if `name` is blank (`missing_field`).
2. Resolve optional `?campaign=` **before any write** (`campaignParam`) so a bad campaign ref fails fast and
   leaves no orphaned record — a 400 `invalid_field`, not a partially applied create.
3. If `email` is non-blank: `FindContactByEmail(ws, email)` (case-insensitive). `len>1` → 409 `ambiguous_match`.
   `len==1` → take `creator := existing.CreatedBy`, **re-decode the same raw body over the existing struct**
   (so unspecified fields keep their stored values — this is a merge, not a replace), restore
   `existing.CreatedBy = creator`, resolve `company_id` from handle to internal id, then
   `UpdateContact(ws, &existing, 0)` — **expectedVersion is hardcoded 0**, i.e. an upsert is deliberately
   *not* optimistic-concurrency-checked even if the caller sent a `version`.
4. Only the genuine-create branch calls `enforceWorkspaceQuota(..., "contacts")`. **An upsert therefore bypasses
   the plan quota entirely** — defensible (row count doesn't grow) and worth stating explicitly.
5. `CreatedBy` on a create is stamped `sess.Email` with the comment *"stamp the actor; never trust a
   client-supplied value"* — present verbatim at every `CreatedBy` assignment in the file.
6. `attachToCampaign` runs after the write in both branches; it is idempotent (§1.13).

**Companies use the identical shape with `domain` as the key** (`handleCreateCompany`, `:642-711`), same 200/201
split, same `ambiguous_match` at >1, same `company.upsert` audit verb.

**Control flow:** the upsert key is fixed per entity type (contacts: email; companies: domain) — not
client-specified, which keeps it predictable and avoids a "pick any field as unique key" foot-gun. `CreatedBy` is
explicitly preserved from the existing record on merge (`creator := existing.CreatedBy` before the decode
overwrites the struct) — provenance of who *originally* created a record must never be silently reassigned to
whoever's upsert happened to touch it last.

**Disposition: BUILD NOW.** This is precisely the mechanism the charter's "Lead to qualified opportunity" workflow
step 2 requires ("Deterministic email/domain/relationship matching prevents duplicates") and step 5's evidence/fact
distinction complements it (strong non-conflicting matches auto-merge; ambiguous ones need review — crmkit's
`ambiguous_match` 409 is the CRUD-layer analogue of what the charter elevates to full Evidence/Fact/Proposal
machinery). Recommendation: keep the natural-key upsert at the record layer for direct human/UI writes (fast path,
no proposal ceremony needed for a human typing into a form), but any AI-originated write must still route through
the Proposal contract even when the underlying operation would resolve to this upsert — i.e., the *upsert
resolution logic* is worth copying, the *bypass-approval* implication is not (see §3 dropped list).

---

### 1.6 Ref/handle indirection — short opaque handles decoupled from durable ids (rank: HIGH — foundational to compact agent output)

**File:** `internal/protocol/protocol.go:26-107` (`NewID`, `NewHandle`, `FormatRef`, `ParseRef`, `Handle`, `SplitHandle`).

**Design:** two distinct identifier spaces per record:
1. **Internal id** (`ID string`) — globally unique, prefixed (`c_<10 random base32 chars>`), the real FK/PK, never
   shown to agents in isolation, immutable, used for storage joins and audit targets (`protocol.Handle(kind, id)` →
   `"contact/c_3f9a..."`).
2. **Public handle** (`Handle string`) — short (5 chars, `k7m2q`), workspace-and-kind-scoped (not globally unique —
   uniqueness enforced by a unique index on `(workspace_id, kind, handle)` plus retry-on-collision at insert), the
   only thing an agent ever sees or types back, formatted at the wire edge as `contact_k7m2q` by `FormatRef`.

**Exact generators and codecs** (`protocol.go:26-107`), needed to reproduce the id space:
```go
// alphabet: lowercase base32, ambiguity-stripped (no l, o, 0, 1)
"abcdefghijkmnpqrstuvwxyz23456789"

NewID(prefix)  -> prefix + "_" + base32(10 random bytes, no padding)   // e.g. "c_w7x4k2m9pq3rst"
NewHandle()    -> 5 chars drawn from the same alphabet, index = randByte % 32 (bias-free, 32 | 256)
Handle(k,id)   -> "contact/c_w7x4…"     // internal, durable; the audit-target form
FormatRef(k,h) -> "contact_k7m2q"       // agent-facing; "" when handle is empty (so the field is omitted)
ParseRef(in)   -> in[lastIndexAny(in, "/_")+1:]   // the suffix after the last '/' or '_'
```
Handle space is `32^5 ≈ 33.5M` per `(workspace, kind)` — uniqueness is a DB unique index on
`(workspace_id, kind, handle)` plus retry-on-collision at insert, **not** a birthday-safe space, so the retry
loop is mandatory, not defensive. Prefix letters are per-kind (`c_`, and analogous single letters elsewhere);
they exist so ids are self-describing in logs.

Because `ParseRef` just takes the suffix, an **internal id also parses** (`c_3f9a…` → `3f9a…`), which is wrong —
so `store.ResolveHandle` matches the parsed value against the `handle` column **and** the raw input against the
`id` column, accepting either. Any reimplementation of the liberal-parse idea needs that same two-sided lookup or
it will silently fail on internal ids.

`ParseRef` is deliberately **liberal in what it accepts back**: `contact_k7m2q`, `contact/k7m2q`, or the bare
`k7m2q` are all normalized to the same handle body (it just takes the suffix after the last `/` or `_`). This means
an agent that mangles the separator, or echoes back a value it saw in a different rendering context, still resolves.

**The specific decision worth keeping:** the wire representation (`FormatRef`) is centralized in one function so
the separator/prefix convention could change without touching storage — and the *acceptance* side (`ParseRef`) is
intentionally more permissive than the *emission* side, a defensive asymmetry appropriate for LLM clients that
don't reliably preserve exact string formats.

**Disposition: PARTIAL BUILD NOW.** SeaRM already has UUID primary keys and does not need a second internal-id
layer — that part of crmkit's design exists only because crmkit has no separate display-vs-storage schema. What
*is* worth taking: (a) a **short, agent-facing display token** for records surfaced through the MCP/agent surface
specifically (SeaRM UUIDs are needlessly long and expensive in agent context/tokens — a workspace-scoped short
alias resolvable back to the UUID is a real token-cost saving over many-tool-call agent sessions), and (b) the
**liberal-parse-of-any-representation** principle for any tool argument that accepts a record reference. Build the
short-alias-with-liberal-resolution pattern into the MCP/agent tool layer (Phase 4, "compact agent-oriented
output"); do not touch SeaRM's core id scheme.

---

### 1.7 Content negotiation: plain-text-first, JSON on request (rank: MEDIUM-HIGH — the concrete "compact agent-oriented output" mechanism)

**File:** `internal/render/render.go` (`WantJSON`, `Respond`, `Line`, `Record`).

**Wire format:** default response (no special `Accept`, no `?format=`) is grepable plain text, one labeled line
per record:
```
contact/c_ab12  name="Jane Doe" email=jane@acme.com stage=lead owner=alice@acme.com
# total: 42
# next: eyJjIjoi...
```
`?format=json` or `Accept: application/json` gets the equivalent structured JSON
(`{"items":[...],"total":42,"next_cursor":"..."}`). Every list response ends with a `#`-prefixed trailer line
carrying the total row count and, if more pages remain, the next cursor — visible even in plain-text mode, so an
agent parsing raw text still knows whether to keep paging.

**Complete format specification** — everything needed to rebuild this layer without the Go source.

*Negotiation precedence* (`render.WantJSON`, `render.go:16-24`), in order:
1. `?format=json` (case-insensitive, trimmed) → JSON, **overrides Accept**.
2. `?format=text` → plain text, **overrides Accept**.
3. `Accept` header contains the substring `application/json` (case-insensitive) → JSON.
4. Otherwise → plain text. **Plain text is the default for a bare request with no headers.**

*JSON mode:* `Content-Type: application/json; charset=utf-8`, encoder with `SetIndent("", "  ")` — i.e. responses
are **pretty-printed with two-space indent**, not minified. Error responses use a non-indented encoder.
*Text mode:* `Content-Type: text/plain; charset=utf-8`, a trailing `\n` is appended if absent.

*`Line(handle, fields...)`* — one grepable record line:
- starts with the handle/ref token, then for each field **two spaces**, `key`, `=`, value;
- **empty values are omitted entirely** (no `key=`, no `null`, no `""`);
- value quoting (`quote()`): if the value contains a space, tab, or `"` it is wrapped in double quotes **and any
  embedded `"` is replaced with `'`** (not escaped — replaced, so the line can never contain an inner quote);
- result: `contact_ab12  name="Jane Doe" email=jane@acme.com stage=lead`.

*`Record(fields...)`* — the single-record detail block:
- one `key:` per line, keys **left-padded to `max(len(key))+1`** then two spaces, then the value
  (`fmt.Sprintf("%-*s  %s\n", width+1, key+":", val)`);
- empty values omitted (and excluded from the width calculation);
- trailing newline trimmed.
```
handle:   contact_ab12
version:  7
name:     Jane Doe
email:    jane@acme.com
```

*List trailers* (`respondList`, `server/query.go:285-295`) — the text body is the per-entity list rendering,
which already ends with its own count line, and then:
```
<one Line per record>
# 42 contact(s)          <- emitted by render.Contacts/Tickets/Campaigns/... = len(page), NOT the total
# total: 842             <- appended by respondList only when a total was computed
# next: eyJjIjoi...      <- appended only when a next cursor exists
```
The JSON equivalent is `{"items":[...], "next_cursor":"...", "total":842}`, with `total` **absent** for envelope
lists that are not keyset-paginated (activities, campaign members, audit, reminders — those pass `nil`).
Note the deliberate two-count design: `# N <kind>(s)` is the page size, `# total:` is the filter-wide count.

*Timestamps* (`render.Stamp`, `entities.go:17`): layout `"2006-01-02T15:04Z07:00"` — RFC3339 **truncated to the
minute**, with the offset, formatted in the value's own location (callers localize first, §1.18). Zero time → `""`
→ field omitted. Example: `2026-06-06T07:14-07:00`, or `2026-06-06T14:14Z` for UTC.

*Messages with no record body* (`render.Text`): text mode writes the bare string; JSON mode wraps it as
`{"message":"<text>"}`. This is what every `OK deleted ...` / `OK attached ...` response uses.

**Decision worth keeping:** the field-formatting helpers (`render.Line`, `render.Record`) are opinionated about
what an LLM should see: empty fields are omitted entirely (not `null`, not `""`— just absent, reducing token noise),
multi-word values are quoted so the line stays parseable, and a single-record "detail" view pads keys to a common
width for scanability. This is explicitly optimized for a model reading raw text over a wire, not for a UI renderer.

**Disposition: DEFER**, but not because it's low-value — because it conflicts with SeaRM's actual transport
(GraphQL over HTTP, not a bespoke plain-text/JSON dual format), and building a parallel plain-text rendering layer
for an already-GraphQL platform is real, ongoing surface-area cost for a benefit (token savings vs. JSON) that is
smaller once the MCP layer itself does compaction (§1.6, trimmed/selected fields, pagination). **Trigger to revisit:**
if token-cost telemetry on the eventual MCP tool surface (charter's `AgentRun` cost accounting, once built) shows
that GraphQL JSON verbosity is a material fraction of agent token spend on read-heavy tool calls, build a
compact/text rendering mode specifically for the MCP tool responses (not the whole API) — that is a much smaller
surface than crmkit's whole-API content negotiation.

---

### 1.8 Cursor-based keyset pagination with an opaque cursor + explicit total (rank: HIGH — deterministic API semantics, "stable pagination" named in charter)

**Files:** `internal/store/query.go:14-233` (`Cursor`, `DecodeCursor`, `buildListSQL`, `countMatching`),
`internal/server/query.go:63-166, 281-295` (`parseListQuery`, `respondList`).

**Wire format:** `GET /contacts?sort=-updated_at&limit=50` → response carries `next_cursor` (base64url JSON:
`{"c":"updated_at","d":true,"n":true,"v":"1750000000","i":"c_ab12"}` — sort column, direction, numeric-ness, the
last row's sort value, and its id as tiebreaker) plus `total` (a `COUNT(*)` over the same filtered WHERE clause,
independent of the page). Passing `?cursor=<opaque>` continues from exactly that row; **the cursor also carries its
own sort spec**, so a client cannot desync sort and cursor across requests (`effectiveSort()` prefers the cursor's
embedded sort over any new `?sort=` on follow-up calls).

**Exact cursor codec** (`store/query.go:51-80`) — reproduce literally or cursors won't round-trip:
```go
type Cursor struct {
    Col  string `json:"c"`   // the *real column name*, e.g. "updated_at" (not the user-facing field alias)
    Desc bool   `json:"d"`
    Num  bool   `json:"n"`   // sort column is numeric -> Val is parsed back with ParseInt
    Val  string `json:"v"`   // last row's sort value, ALWAYS carried as a string
    ID   string `json:"i"`   // last row's internal id, the tiebreaker
}
// encode: base64.RawURLEncoding (URL-safe alphabet, NO padding) over compact JSON
// decode: empty/whitespace -> (nil, nil); bad base64, bad JSON, or empty Col -> ErrBadCursor
```
Worked example: `{"c":"updated_at","d":true,"n":true,"v":"1750000000","i":"c_ab12"}` →
`eyJjIjoidXBkYXRlZF9hdCIsImQiOnRydWUsIm4iOnRydWUsInYiOiIxNzUwMDAwMDAwIiwiaSI6ImNfYWIxMiJ9`.

**Exact paging semantics** (`parseListQuery` + `buildListSQL`):
- `?limit=` default **50**, clamped to `[1, 200]` (out-of-range is clamped, never an error).
- The page query is `... WHERE <filters> AND (<col>, id) < (?, ?) ORDER BY <col> DESC, id DESC LIMIT <limit+1>`
  (`>` / `ASC` when ascending). A **row-value comparison**, not the `col < v OR (col = v AND id < i)` expansion —
  the comment notes both backends support it.
- `limit+1` rows are fetched; if more than `limit` came back, the cursor is built from **`out[limit-1]`** (the
  last row of the returned page) and the extra row is discarded.
- `total` is a separate `COUNT(*)` over the byte-identical WHERE clause built by `buildWhere`, which deliberately
  **excludes the cursor predicate, the ORDER BY, and the LIMIT** — the comment calls the cursor "a pagination
  position, not a result filter." That single shared `buildWhere` is why page and total can never diverge.
- `effectiveSort()`: when a cursor is present, its `Col`/`Desc`/`Num` **win over any `?sort=` on the same
  request**, and `?sort=` is not even parsed. Sort can only be chosen on the first (cursor-less) call.
- Default sort when neither is given: the entity's `defSort` (`updated_at` for every entity), descending, numeric.

**Full request/response:**
```
GET /contacts?stage=lead&sort=-updated_at&limit=2
-> 200 (text)
contact_ab12  name="Jane Doe" email=jane@acme.com stage=lead updated=2026-08-05T10:03Z
contact_k7m2q name="Ravi Rao" email=ravi@beta.io  stage=lead updated=2026-08-04T18:20Z
# 2 contact(s)
# total: 842
# next: eyJjIjoidXBkYXRlZF9hdCIsImQiOnRydWUsIm4iOnRydWUsInYiOiIxNzUwMDAwMDAwIiwiaSI6ImNfYWIxMiJ9

GET /contacts?cursor=eyJjIjoi...            (filters must be repeated; only the sort rides in the cursor)
-> next page; when the last page is reached "# next:" is simply absent and next_cursor is ""

GET /contacts?cursor=garbage
-> 400  ERROR invalid_cursor / HINT The cursor is malformed. Omit it to start from the first page.
```

**The specific decision worth keeping — cursor tamper-resistance without signing:** the cursor is not signed/HMAC'd
(cheap, avoids a secret-management dependency for something not truly sensitive), but its embedded sort **column
identifier** would be string-interpolated into `ORDER BY`/the keyset comparison if trusted blindly — a real SQL
injection surface if an attacker crafts a cursor with an arbitrary column name. The mitigation: `parseListQuery`
explicitly re-validates any decoded cursor's column against the entity's **whitelisted sortable columns**
(`cfg.sortableColumn(cur.Col)`) before it's ever used, rejecting anything that isn't a real, code-defined column —
so an untrusted opaque token can carry structure but never an injectable identifier. There's an explicit
"query-safety test" mentioned in comments (`query.go:323`) asserting this invariant holds for every derived/EXISTS
expression too.

**Also notable:** `buildListSQL` fetches `Limit+1` rows to detect "is there a next page" without a second COUNT
query on the hot path; the real total is one extra `COUNT(*)` query (`countMatching`), reusing the identical WHERE
clause so total and page can never diverge from different filter logic.

**Disposition: BUILD NOW.** SeaRM's GraphQL API already has cursor pagination in most list resolvers (standard
Relay-style), so this is less about introducing pagination and more about **auditing whether SeaRM's pagination
gives the model an explicit, reliable "how many more / should I keep paging" signal**, and whether any
user-suppliable sort parameter is validated against a column whitelist before being interpolated (the same
injection class applies to any raw-SQL or dynamic-ORM-order-by path). Recommendation: treat this as a hardening
task against SeaRM's existing pagination rather than new construction — verify the whitelist-before-interpolate
discipline exists wherever agent/MCP tool calls can pass a sort field.

---

### 1.9 Uniform, whitelisted, injection-safe query/filter DSL (rank: MEDIUM-HIGH — deterministic API semantics)

**File:** `internal/server/query.go:16-166, 297-455` (`queryConfig`, `parseListQuery`, per-entity whitelists).

**Wire format:** `?field=value` (implicit eq), or `?field=op:value` with `op` ∈
`{eq,ne,gt,gte,lt,lte,like,in,is,not}` — e.g. `?stage=eq:lead`, `?amount_cents=gte:50000`,
`?created_at=gte:2026-01-01T00:00:00Z`, `?tags=competitor,decision-maker` (AND-ed membership), `?custom.region=like:west`,
`?on_behalf_of=alice@acme.com` (a *derived* filter — matches records with an activity performed on behalf of that
principal, not a stored column). An unknown field returns `400 invalid_filter` with the **full whitelist of legal
fields for that entity** in the hint text (`"unknown filter field X; filter by: " + keysOf(cfg.filter)`) — so a
model's very first wrong guess teaches it the entire valid vocabulary in one round trip, no docs lookup needed.

**Complete grammar and every whitelist** — recorded in full because this is a DEFER row and the whitelists are
the only part with real information content.

*Operator map* (`opToSQL`, `query.go:53-56`) — the closed set, exhaustive:
| token | SQL | notes |
|---|---|---|
| `eq` | `=` | the implicit default when no `op:` prefix is present |
| `ne` | `!=` | |
| `gt` `gte` `lt` `lte` | `>` `>=` `<` `<=` | |
| `like` | `LIKE`/`ILIKE` | dialect sentinel; value is wrapped as `%value%`; **text columns only**, else 400 `invalid_op` |
| `in` | `IN (?,?,…)` | comma-separated; each element coerced by column kind |
| `is` | `IS NULL` | value must literally be `null`, else 400 `invalid_value` |
| `not` | `IS NOT NULL` | same |

Parsing rule: `?field=raw` → split on the **first** `:`; if the prefix is a known op token it is the operator,
otherwise the whole string is the value (so `?name=http://x` is not mis-parsed as an operator).
Value coercion by column kind: `colText` → string as-is; `colInt` → `ParseInt` or 400; `colTime` → **RFC3339
only**, stored/compared as a Unix integer (`?created_at=gte:2026-01-01T00:00:00Z`).

*Reserved (non-filter) params:* `sort`, `limit`, `cursor`, `search`, `format`, `tags`. Every **other** query
parameter is interpreted as a filter and must be in the entity's whitelist or the request 400s.

*Per-entity whitelists* (`query.go:353-455`) — filterable fields / sortable fields / fuzzy-search columns.
Default sort is `-updated_at` for all six. `tags` and `custom.<key>` availability is per entity.

| Entity | Filterable | Sortable | `?search=` covers | tags | custom | `on_behalf_of` |
|---|---|---|---|---|---|---|
| contact | `name` `email` `phone` `company_id` `owner` `stage` `created_by` `created_at` `updated_at` `last_outreach`* `outreach_count`* | `created_at` `updated_at` `name` | name, email, phone, company_id, stage | yes | yes | yes |
| company | `name` `domain` `created_by` `created_at` `updated_at` `last_outreach`* `outreach_count`* | `created_at` `updated_at` `name` | name, domain, notes | yes | yes | yes |
| deal | `title` `stage` `status` `contact_id` `company_id` `currency` `amount_cents` `created_by` `created_at` `updated_at` | `created_at` `updated_at` `amount_cents` `title` | title | no | yes | yes |
| ticket | `subject` `status` `requester_id` `assignee` `created_by` `created_at` `updated_at` | `created_at` `updated_at` `subject` | subject, content | yes | yes | yes |
| task | `title` `assignee` `contact_id` `company_id` `deal_id` `ticket_id` `created_by` `due_at` `done_at` `created_at` `updated_at` | `created_at` `updated_at` `due_at` `title` | title | no | yes | **no** |
| campaign | `name` `status` `created_by` `created_at` `updated_at` | `created_at` `updated_at` `name` | name, description | no | yes | **no** |

`*` = derived (a correlated subquery, not a column) — see below.

*Tag filtering* (`cfg.tags`): `?tags=a,b` or a repeated `?tags=` — each tag becomes a **separate AND-ed**
`tags LIKE '%"tag"%'` predicate, because tags are stored as a JSON-array *string*. So multiple tags mean "carries
all of them," and the match is substring-on-quoted-value (a tag containing `"` would break it).

*Custom-field filtering* (`cfg.custom`): `?custom.<key>=value`, `?custom.<key>=eq:value`,
`?custom.<key>=like:term`. Key must match `^[A-Za-z0-9_]{1,64}$`; the key is passed as a **bound parameter** to a
dialect-specific JSON-extraction expression (`d.jsonText(column, key)`), not interpolated. `like:` becomes
`%term%`; no other operators are supported on custom keys.

*The three derived/whitelisted SQL expression sets, verbatim* — these are the only strings allowed to stand in
for a column identifier, each asserted closed by the query-safety test:
```sql
-- derivedExprs (outreach segmentation; "outreach" = activity kinds call/email/meeting, store.OutreachKindsSQL)
contactLastOutreachExpr  = (SELECT MAX(a.created_at) FROM activities a WHERE a.workspace_id = contacts.workspace_id AND a.contact_id = contacts.id AND a.kind IN (<OutreachKindsSQL>))
contactOutreachCountExpr = (SELECT COUNT(*)          FROM activities a WHERE a.workspace_id = contacts.workspace_id AND a.contact_id = contacts.id AND a.kind IN (<OutreachKindsSQL>))
companyLastOutreachExpr  = (SELECT MAX(a.created_at) FROM activities a WHERE a.workspace_id = companies.workspace_id AND a.company_id = companies.id AND a.kind IN (<OutreachKindsSQL>))
companyOutreachCountExpr = (SELECT COUNT(*)          FROM activities a WHERE a.workspace_id = companies.workspace_id AND a.company_id = companies.id AND a.kind IN (<OutreachKindsSQL>))

-- behalfExprs (the ?on_behalf_of= filter; the single "?" is the only bound value)
contactBehalfExpr = EXISTS (SELECT 1 FROM activities a WHERE a.workspace_id = contacts.workspace_id  AND a.contact_id = contacts.id  AND lower(a.on_behalf_of) = lower(?))
companyBehalfExpr = EXISTS (SELECT 1 FROM activities a WHERE a.workspace_id = companies.workspace_id AND a.company_id = companies.id AND lower(a.on_behalf_of) = lower(?))
dealBehalfExpr    = EXISTS (SELECT 1 FROM activities a WHERE a.workspace_id = deals.workspace_id     AND a.deal_id    = deals.id     AND lower(a.on_behalf_of) = lower(?))
ticketBehalfExpr  = EXISTS (SELECT 1 FROM activities a WHERE a.workspace_id = tickets.workspace_id   AND a.ticket_id  = tickets.id   AND lower(a.on_behalf_of) = lower(?))
```
Two design details worth carrying: the subqueries reference the outer table **unaliased** (matching the FROM that
`buildListSQL`/`countMatching` emit — a whole class of bug avoided by having exactly one place that writes FROM);
and `MAX()` over zero rows is `NULL`, so **`?last_outreach=is:null` is exactly "never contacted"** — a
genuinely useful segment expressed with no extra machinery.

*The one hard invariant, stated in the source comments repeatedly:* filter **identifiers** (columns, derived
expressions, JSON keys) are interpolated because SQL cannot parameterize identifiers, therefore they must come
only from a closed, code-defined set; filter **values** are always bound `?` parameters, no exceptions.

**Decision worth keeping — three closed sets, one per class of "column not literally a column":**
1. `derivedExprs` — code-defined correlated-subquery expressions standing in for a filter column (e.g.
   "outreach_count" is actually `(SELECT COUNT(*) FROM activities WHERE ...)`), asserted closed by a dedicated
   query-safety test, never user-constructible.
2. `behalfExprs` — the `on_behalf_of=` EXISTS predicates, same discipline.
3. `customKeyRe` — a strict identifier regex (`^[A-Za-z0-9_]{1,64}$`) gating which JSON keys inside the `custom`
   column can be filtered on, so a key can't smuggle SQL metacharacters into a JSON-path expression even though the
   key itself has to be interpolated (not bound) into the generated JSON-extraction SQL.

Every one of these exists because the filter *identifier* (column/expression/JSON key) is fundamentally an
interpolation target (SQL doesn't parameterize identifiers), while every filter *value* is always a bound `?`
parameter — the file's comments repeatedly call this out as the single safety invariant the whole layer rests on.

**Disposition: DEFER as literal query-string DSL** (SeaRM is GraphQL; the equivalent is SeaRM's existing
`filter`/`orderBy` GraphQL input types, which already parameterize by construction via the query builder / TypeORM
— the SQL-injection-via-identifier problem crmkit is solving here is largely moot on a typed GraphQL schema).
**BUILD NOW the *principle*:** any place the eventual MCP/agent tool layer accepts a free-text sort/filter field
name from a model (as opposed to routing through SeaRM's typed GraphQL filter input), validate it against a
closed whitelist before it reaches a query builder, and make an unrecognized field's error list the legal
vocabulary — that "teach the model the whitelist in the error" trick is worth keeping regardless of transport.
**Trigger to reconsider building a parallel filter DSL:** if a compact plain-text agent transport (§1.7) is ever
built and it bypasses GraphQL's typed filtering for a lighter-weight text query syntax, at that point this whole
file is the reference design.

---

### 1.10 OAuth 2.1 authorization server for MCP clients, PKCE-only public clients, dynamic client registration (rank: HIGH — directly named in charter: "OAuth-scoped agent credentials")

**File:** `internal/server/handlers_oauth.go` (full RFC 9728 + RFC 8414 + RFC 7591 + RFC 7009 implementation),
`internal/server/handlers_mcp.go:139-155` (`mcpUnauthorized` — the 401 bootstrap).

**Wire format / endpoints:**
```
GET  /.well-known/oauth-protected-resource     RFC 9728 — tells a client which AS protects /mcp
GET  /.well-known/oauth-authorization-server   RFC 8414 — AS capabilities/endpoints
POST /oauth/register                           RFC 7591 — dynamic client registration (public, allowlisted redirect_uris)
GET  /oauth/authorize                          the login page (email-OTP driven)
POST /oauth/authorize                          OTP steps -> redirect with auth code
POST /oauth/token                              code (+PKCE) -> bearer token, or refresh_token -> rotated pair
POST /oauth/revoke                             RFC 7009
```
A credential-less request to `POST /mcp` gets `401` with
`WWW-Authenticate: Bearer resource_metadata="https://host/.well-known/oauth-protected-resource"` — this single
header is what lets ChatGPT/Claude-style MCP clients **self-bootstrap** the entire OAuth flow with zero
pre-configuration: discover the AS, register themselves, and drive the user through PKCE login, without a human
ever hand-typing a client ID.

**Every request and response body, verbatim** (`handlers_oauth.go`). All `/oauth/*` and `/.well-known/*`
responses are JSON with `Cache-Control: no-store`, regardless of `Accept`.

```http
GET /.well-known/oauth-protected-resource                                  # RFC 9728
200 {
  "resource": "https://host/mcp",
  "authorization_servers": ["https://host"],
  "bearer_methods_supported": ["header"],
  "scopes_supported": ["crm"]
}
```
```http
GET /.well-known/oauth-authorization-server                                # RFC 8414
200 {
  "issuer": "https://host",
  "authorization_endpoint": "https://host/oauth/authorize",
  "token_endpoint":         "https://host/oauth/token",
  "registration_endpoint":  "https://host/oauth/register",
  "revocation_endpoint":    "https://host/oauth/revoke",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_methods_supported": ["none"],
  "code_challenge_methods_supported": ["S256"],
  "scopes_supported": ["crm"]
}
```
```http
POST /oauth/register                                                       # RFC 7591 DCR, unauthenticated
Content-Type: application/json
{ "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"], "client_name": "Claude" }

201 {
  "client_id": "<opaque>",
  "client_id_issued_at": 1750000000,
  "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"],
  "client_name": "Claude",
  "token_endpoint_auth_method": "none",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "authorization_endpoint": "https://host/oauth/authorize",
  "token_endpoint": "https://host/oauth/token"
}
# No client_secret is ever issued. No registration_access_token / no RFC 7592 management.
# Errors: 400 invalid_client_metadata (unreadable/non-JSON body),
#         400 invalid_redirect_uri ("At least one redirect_uri is required." |
#             "redirect_uri <u> is not permitted by this server's allowlist.")
# Decoded with a LENIENT json.Unmarshal (not the strict decoder used elsewhere) so unknown
# RFC 7591 fields are ignored rather than rejected — required for real-world client compat.
```
```http
GET /oauth/authorize?response_type=code&client_id=…&redirect_uri=…&code_challenge=…&code_challenge_method=S256&state=…&scope=crm
200 text/html   # the login page; NOT a JSON API
```
Validation on both GET and POST (`validateAuthorizeParams`), each failure rendering an HTML error page with **400
and no redirect** (deliberate: the redirect_uri may itself be what's wrong):
`response_type must be "code".` · `client_id is required.` · `Unknown client_id. Register first via POST
/oauth/register.` · `redirect_uri does not match a registered URI for this client.` · `code_challenge (PKCE) is
required.` · `code_challenge_method must be S256.` (method defaults to `S256` when omitted).

```
POST /oauth/authorize  (form-encoded, three stages against the same URL)
  stage 1: email=alice@acme.com                      -> re-renders with Step="code", emails a 6-digit OTP
  stage 2: email=…&code=482913                       -> verifies OTP, then ALWAYS renders the workspace step
  stage 3: login_ticket=<signed>&workspace_id=ws_1   -> 302 to redirect_uri?code=<plaintext>&state=<state>
           (or login_ticket=<signed>&new_workspace=Acme -> creates one, quota-checked, then the same 302)
```
The stage-2→3 hop carries a **signed login ticket** (`auth.NewLoginTicket(secret, userID, email)`) rather than
re-verifying the single-use OTP; the workspace step is shown even for single-workspace users (pre-selected, still
one click) so the pinning is always an explicit act. The chosen workspace is written into
`store.AuthCode{ClientID, UserID, WorkspaceID, RedirectURI, CodeChallenge, Scope}`. Stage 3 re-checks membership
via `MemberRole(workspaceID, userID)` — an echoed hidden field is never trusted.

```http
POST /oauth/token       Content-Type: application/x-www-form-urlencoded
grant_type=authorization_code&code=<plaintext>&client_id=<id>&redirect_uri=<uri>&code_verifier=<verifier>

200 {
  "access_token": "<opaque bearer>",
  "token_type": "Bearer",
  "refresh_token": "<opaque>",
  "scope": "crm"          // present only when the authorize request carried a scope
}
# NOTE: no "expires_in" and no "id_token". Comment: advertising an absolute deadline would
# mislead clients into refresh churn; the access token has a sliding idle window and clients
# are expected to refresh reactively on a 401.

grant_type=refresh_token&refresh_token=<opaque>&client_id=<id>
200 same shape; the presented refresh token is CONSUMED and a new pair issued, and the
    access token paired with the consumed refresh token is explicitly revoked.

# Errors (RFC 6749 shape, 400 unless noted):
#  invalid_request        "code, client_id and code_verifier are required." / "refresh_token is required."
#                         / "Could not parse form body."
#  invalid_grant          "Authorization code is invalid or expired."
#                         "client_id or redirect_uri does not match the code."
#                         "PKCE verification failed."
#                         "Refresh token is invalid or expired. Sign in again."
#                         "client_id does not match the refresh token."
#  unsupported_grant_type `Supported grants: "authorization_code" and "refresh_token".`
#  server_error (500)     "Could not mint a token." / "Could not store the token." / "…refresh token."
```
The authorization code is stored **hashed** (`auth.HashToken(code)`) and consumed atomically
(`ConsumeAuthCode(hash, now)`) — single use, TTL `mcp.auth_code_ttl_seconds`. Both `client_id` **and**
`redirect_uri` are re-checked against the stored grant before PKCE is verified.

```http
POST /oauth/revoke      token=<access or refresh token>              # RFC 7009
200 (empty body) ALWAYS — including for an unknown token. Both the access-token table and the
    refresh-token table are tried by hash; failures are logged, never surfaced.
```
```http
POST /mcp   (no Authorization header)
401
WWW-Authenticate: Bearer resource_metadata="https://host/.well-known/oauth-protected-resource"
{ "jsonrpc": "2.0", "error": { "code": -32600, "message": "auth_required", "data": "<desc>" } }

# with a bad/expired bearer the challenge gains an error code:
WWW-Authenticate: Bearer error="invalid_token", resource_metadata="https://host/.well-known/oauth-protected-resource"
```
Note the 401 body is a **JSON-RPC error object**, not the §1.1 envelope — a third error dialect, correct for the
transport. Also note `scopes_supported: ["crm"]` is **advertised but not enforced**: the source says plainly that
a token grants its workspace's full CRM and the scope exists only because some clients require one. Do not copy
that — SeaRM has real per-scope enforcement (`ALL_OAUTH_SCOPES`) and should use it.

**Control flow — three load-bearing decisions:**
1. **Public clients only, PKCE S256 mandatory, no client secrets** (`token_endpoint_auth_methods_supported:
   ["none"]`). This is the correct shape for MCP clients that cannot keep a secret (desktop/browser-based
   assistants) — the code is useless without the verifier, so DCR (dynamic client registration) can stay unauthenticated
   without becoming an open door.
2. **The workspace is chosen and pinned during the authorize flow, not implied by the token.** After email-OTP
   verification, if the user belongs to more than one workspace they explicitly pick one (`renderWorkspacePicker`)
   or create a new one (gated by `canCreateWorkspace` plan quota, §1.11); that choice is baked into the
   authorization code (`store.AuthCode{WorkspaceID: ...}`) and flows through to every subsequent access and refresh
   token. **A connected agent's credential is workspace-scoped for its entire lifetime — it cannot silently expand
   to a workspace the user adds later**, matching the charter's Principal contract need for scoped agent identity.
3. **Refresh rotation revokes the paired access token.** `tokenFromRefresh` looks up the **previous access token
   hash** stored alongside the refresh grant and explicitly revokes it (`RevokeTokenByHash`) before issuing the new
   pair — so a leaked old access token cannot outlive the refresh cycle that superseded it. Access tokens
   deliberately carry **no fixed expiry** (`issueTokens` comment: advertising `expires_in` would cause needless
   refresh churn); instead they're revoked reactively via this pairing, and a client is expected to refresh only on
   a 401.

**Also notable:** minted tokens are named after the OAuth client (`tokenName := client.Name`, from the DCR
`client_name`) so a human reviewing `GET /tokens` can see "this token belongs to Claude Desktop" rather than an
opaque id — feeds directly into the Principal contract's audit distinguishability requirement.

**Disposition: BUILD NOW — highest-value single item in this repo for Phase 4.** SeaRM's own auth is
session/SSO-oriented for human users; it does not yet have this narrow slice (a standards-compliant OAuth AS
purpose-built for zero-config MCP client bootstrap with workspace-pinned scoping). Recommendation: reimplement the
four endpoints (protected-resource metadata, AS metadata, DCR, authorize+token+revoke) against SeaRM's existing
user/workspace/session model — reuse SeaRM's login mechanism in place of crmkit's email-OTP, but keep: PKCE-only
public clients, workspace-pinning at authorize time with an explicit picker when ambiguous, and refresh-rotation-
revokes-prior-access-token. This *is* "OAuth-scoped agent credentials" from the charter, close to verbatim.

---

### 1.11 Deterministic per-workspace and per-user plan quotas, enforced pre-write (rank: MEDIUM — deterministic API semantics, resource governance)

**File:** `internal/server/quota.go`.

**Wire format:** `403 plan_limit_reached`:
```
Plan "free" allows at most 500 contacts (currently 500). Ask a workspace admin to raise the limit or change the plan.
```
`GET /whoami` proactively reports current usage vs. limit per resource (`ResourceUsage{Resource, Used, Limit}`,
`-1` meaning unlimited) so an agent can self-throttle **before** attempting writes that would fail.

**Exact shapes** (`quota.go`, `handlers_auth.go:184-215`). The governed resource list is closed and hardcoded:
`contacts, companies, deals, tickets, tasks, activities, members` (workspace plan) plus `workspaces` (governed by
the **user's** plan, not the workspace's).
```http
GET /whoami
200 (JSON)
{
  "email": "alice@acme.com",
  "workspace_id": "ws_3f9a",
  "workspace_name": "Acme",
  "token_name": "Claude",              // the DCR client_name, see §1.10
  "plan": "free",
  "usage": [
    {"resource":"contacts",  "used":500, "limit":500},
    {"resource":"companies", "used":12,  "limit":100},
    {"resource":"deals",     "used":3,   "limit":50},
    {"resource":"tickets",   "used":0,   "limit":50},
    {"resource":"tasks",     "used":7,   "limit":-1},   // -1 = unlimited
    {"resource":"activities","used":91,  "limit":1000},
    {"resource":"members",   "used":2,   "limit":3},
    {"resource":"workspaces","used":1,   "limit":1}
  ]
}
```
```
200 (text — same data through render.Record)
email:           alice@acme.com
workspace:       ws_3f9a
workspace_name:  Acme
token:           Claude
plan:            free
contacts:        500 / 500
tasks:           7 / unlimited        <- limitLabel(): "%d / %d", or "%d / unlimited" when limit < 0
...
```
```
POST /contacts  (over quota)
-> 403
ERROR plan_limit_reached
HINT  Plan "free" allows at most 500 contacts (currently 500). Ask a workspace admin to raise the limit or change the plan.
```
The check is `used >= limit` evaluated **before** the store call, with `limit < 0` short-circuiting to allow.
Enforcement sites are exactly: contacts, companies, deals, tickets, tasks (one each) and activities (four call
sites — one per parent entity's activity-create endpoint). **Upserts are not counted** (see §1.5 step 4).
`members` usage is `CountResource("members") + CountResource("invites")`, so outstanding invites occupy seats.

**Decision worth keeping:** quota is enforced **before** the mutating store call, not as a rollback-after — every
`handleCreateX` calls `enforceWorkspaceQuota(...)` and returns early on failure, so a rejected create never touches
storage. Also: "member seat" usage counts pending invites plus actual members (`workspaceResourceCount`) — an
org can't evade a seat limit by leaving invites outstanding forever.

**Disposition: DEFER as a bespoke quota subsystem** — SeaRM's billing/plan/entitlement system almost certainly
already governs record-count limits at the platform level (workspace subscription tiers), so building a
parallel quota table here would duplicate existing product infrastructure. **What's worth keeping conceptually**
and should inform Phase 2/4 work regardless: an `AgentTask`/`AgentRun` budget check should follow the identical
pre-write-not-post-write discipline (check the budget before starting the run, not after burning tokens), and
`GET /whoami`'s "tell the agent its own ceiling proactively" pattern is worth replicating for agent cost/budget
visibility specifically (surface remaining `AgentTask` budget to the model before it plans a research loop).
**Trigger to build a literal parallel quota check:** none anticipated — SeaRM's entitlements system is the system
of record for this; only revisit if SeaRM's entitlement checks turn out not to cover agent-specific resources
(e.g., a per-workspace cap on concurrent `AgentTask`s) that don't fit the existing billing model.

---

### 1.12 Ticket entity and lifecycle (rank: MEDIUM-HIGH — named in charter: "ticket and campaign workflow models")

**File:** `internal/protocol/protocol.go:280-313` (`Ticket` struct), `internal/server/handlers_crm.go:927-1127`.

**The full struct, verbatim** (`protocol.go:283-313`) — every field, every JSON tag, so the model is rebuildable
without the Go source:
```go
type Ticket struct {
    ID      string `json:"id"`                          // durable internal id, "t_<10 base32>"
    Handle  string `json:"handle,omitempty"`            // bare short handle, e.g. "k7m2q"
    Version int64  `json:"version,omitempty"`           // optimistic-concurrency token, §1.4
    Subject string `json:"subject"`                     // REQUIRED on create
    Content string `json:"content,omitempty"`           // the opening message / body
    Status  string `json:"status,omitempty"`            // open | pending | solved  ("" -> open)
    RequesterID     string `json:"requester_id,omitempty"`      // -> Contact
    RequesterName   string `json:"requester_name,omitempty"`    // resolved on read, never persisted
    RequesterHandle string `json:"requester_handle,omitempty"`  // resolved on read, never persisted
    Assignee  string         `json:"assignee,omitempty"`        // a bare email, NOT an FK
    Tags      []string       `json:"tags,omitempty"`
    Custom    map[string]any `json:"custom,omitempty"`
    CreatedAt time.Time      `json:"created_at"`
    UpdatedAt time.Time      `json:"updated_at"`
    CreatedBy string         `json:"created_by,omitempty"`      // server-stamped once, never changes
    OnBehalfOf     []string   `json:"on_behalf_of,omitempty"`   // DERIVED from activities, §1.17
    ActivityCount  int        `json:"activity_count,omitempty"` // derived, single-fetch only
    LastActivityAt *time.Time `json:"last_activity_at,omitempty"`
}
```

**The complete endpoint surface and its wire traces** (`handlers_crm.go:927-1130`):
```http
GET /tickets?status=open&assignee=alice@acme.com&sort=-updated_at&limit=50
200 (text)
ticket_k7m2q  subject="Can't log in" status=open requester="Jane Doe" assignee=alice@acme.com tags=billing updated=2026-08-05T10:03Z activities=3 last_activity=2026-08-05T09:40Z
# 1 ticket(s)
# total: 1

POST /tickets
{"subject":"Can't log in","content":"Getting a 500 on submit","requester_id":"contact_k7m2q","status":"open"}
201 (text — render.Ticket detail block)
handle:         ticket_k7m2q
version:        1
subject:        Can't log in
status:         open
requester:      Jane Doe
requester_ref:  contact_k7m2q
content:        Getting a 500 on submit
created:        2026-08-05T10:03Z
created_by:     alice@acme.com
updated:        2026-08-05T10:03Z
   errors: 400 bad_request  `Send JSON, e.g. {"subject":"Can't log in","content":"...","requester_id":"contact_...","status":"open"}.`
           400 missing_field `"subject" is required to create a ticket.`
           400 invalid_field `"status" must be one of: open, pending, solved.`
           403 plan_limit_reached (resource "tickets")
   audit:  ticket.create  target=ticket/<internal id>  detail=<subject>

GET    /tickets/{id}                      -> detail block + activity_count/last_activity/on_behalf_of
PATCH  /tickets/{id}                      -> partial merge; If-Match or body "version"; 412 on conflict
   {"status":"solved"}                       audit: ticket.update detail=diffTicket(before,after) (§1.16)
DELETE /tickets/{id}[?confirm=<token>]    -> 409 confirmation_required, then 200 "OK deleted <ref>"

GET  /tickets/{id}/activities?limit=50&on_behalf_of=alice@acme.com   -> the conversation
POST /tickets/{id}/activities  {"kind":"note","body":"Asked for logs"}
   201; kind ∈ note|call|email|meeting|task; 400 missing_field `"body" is required to log an activity.`
   quota: counted against "activities"; audit: activity.create
```
`requester_id` accepts **any** reference representation (`contact_k7m2q`, `contact/k7m2q`, bare `k7m2q`, or the
raw internal id) and is resolved leniently via `relationID` — an unresolvable value is **stored as-is** rather
than rejected, and simply renders unresolved. That leniency is a deliberate agent affordance and also a real data
-integrity hole; on SeaRM it should be a hard validation error instead.

**Model, field-by-field, with the reasoning behind each:**
- `Subject` (required), `Content` (the opening message/body — explicitly the *first* message; comment notes
  "replies/notes (the conversation) are a later addition," i.e., crmkit's own ticket model is deliberately v1-thin).
- `Status`: closed enum, **exactly three values today** — `open | pending | solved` — with `""` accepted as "not
  yet set, defaults to open." Comment explicitly flags the roadmap gap: `"(on-hold, closed and the full lifecycle
  come later.)"` — i.e., crmkit's own authors know this is an intentionally incomplete state machine, not a
  finished design.
- `RequesterID` → a `Contact` (the customer this ticket is *for*), resolved on read to `RequesterName`/`RequesterHandle`
  for display without a second call.
- `Assignee`: a bare email string (not a foreign key to a user table) — mirrors the same convention used for
  `owner` on contacts and `assignee` on tasks: **the assignee doesn't have to be a crmkit member**, it's just an
  email, so external/unregistered people can be named as responsible parties.
- **Conversation = the generic `Activity` log, filtered by `TicketID`**, not a ticket-specific reply table
  (`handleListTicketActivities`, `handleCreateTicketActivity`) — a ticket's "conversation" is literally the same
  activity timeline every other entity has (notes/calls/emails/meetings), just scoped. This is the single biggest
  design decision in the ticket model: **no separate messaging subsystem**, tickets ride the same interaction log
  as everything else.
- `ActivityCount`/`LastActivityAt` computed on read the same way as every other entity (§ fillTicketActivity).

**Disposition: BUILD NOW**, mapped onto SeaRM's existing custom-object mechanism per the charter's explicit
constraint ("Custom objects are the only extension mechanism for business-specific records. Never add industry
records to the core schema.") — i.e., Ticket should ship as a **standard object definition** (part of a support
vertical-app or as a first-class object if the charter's phase-5 framework treats "ticket" as horizontal enough to
warrant it — worth a product call, not an engineering one). What to actually copy: (a) reuse SeaRM's existing
Activity/Timeline/Note mechanism for the conversation instead of inventing a ticket-reply subsystem — same
principle crmkit used; (b) the closed three-state lifecycle as a starting enum, explicitly marked (as crmkit's own
comment does) as intentionally incomplete, expandable later; (c) `assignee`-as-identifier-not-required-member-FK is
almost certainly **wrong for SeaRM** — SeaRM has real workspace members with permissions, so assignee should be a
proper member/workspace-user reference, not a bare email string. Call this out explicitly as a **rejected**
sub-decision (see §3).

---

### 1.13 Campaign entity: brief + deduped many-to-many membership + provenance (rank: MEDIUM-HIGH — named in charter)

**File:** `internal/protocol/protocol.go:315-352` (`Campaign`, `CampaignMember`), `internal/server/handlers_campaign.go`.

**The two structs, verbatim** (`protocol.go:320-351`):
```go
type Campaign struct {
    ID          string `json:"id"`
    Handle      string `json:"handle,omitempty"`
    Version     int64  `json:"version,omitempty"`
    Name        string `json:"name"`                       // REQUIRED on create
    Description string `json:"description,omitempty"`      // the free-text brief
    Status      string `json:"status,omitempty"`           // active | paused | done  ("" -> active)
    Custom    map[string]any `json:"custom,omitempty"`
    CreatedAt time.Time      `json:"created_at"`
    UpdatedAt time.Time      `json:"updated_at"`
    CreatedBy string         `json:"created_by,omitempty"`
    MemberCounts map[string]int `json:"member_counts,omitempty"` // {"contact":47,"company":12}
}                                                                // single-fetch only, never persisted

type CampaignMember struct {
    Kind    string    `json:"kind"`             // contact | company  (closed set)
    ID      string    `json:"id"`               // internal id of the attached entity
    Handle  string    `json:"handle,omitempty"` // resolved on read
    Name    string    `json:"name,omitempty"`   // resolved on read
    Reason  string    `json:"reason,omitempty"` // free-text provenance: WHY this was gathered
    AddedBy string    `json:"added_by,omitempty"`
    AddedAt time.Time `json:"added_at"`
}
```
Note there is **no join-entity id and no version on membership** — the natural key is
`(workspace, campaign, kind, entity_id)`, which is what makes attach idempotent.

**The complete endpoint surface and its wire traces** (`handlers_campaign.go`):
```http
GET|POST /campaigns
POST {"name":"Series-B fintechs","description":"CTOs at fintechs that raised a Series B in the last year"}
201 (text)
handle:       campaign_9x4kq
version:      1
name:         Series-B fintechs
status:       active
description:  CTOs at fintechs that raised a Series B in the last year
created:      2026-08-05T10:03Z
created_by:   alice@acme.com
updated:      2026-08-05T10:03Z
   errors: 400 bad_request  `Send JSON, e.g. {"name":"Series-B fintechs","description":"CTOs at fintechs that raised a Series B in the last year"}.`
           400 missing_field `"name" is required to create a campaign.`
           400 invalid_field `"status" must be one of: active, paused, done.`
   NOTE: campaigns are NOT quota-enforced — no enforceWorkspaceQuota call on this path.
   audit: campaign.create

GET /campaigns/{id}          -> detail block, and ONLY here are member counts populated:
   contacts:   47
   companies:  12
PATCH  /campaigns/{id}  {"status":"done"}      -> merge + version check; audit campaign.update detail=<status>
DELETE /campaigns/{id}[?confirm=<token>]       -> confirm-gated; audit campaign.delete

GET  /campaigns/{id}/members?kind=contact&limit=200      (limit default 200; kind optional, contact|company)
200 (text)
contact_k7m2q  kind=contact name="Jane Doe" reason="matches the brief" added=2026-08-05T10:03Z
# 1 member(s)
   -- no total, no cursor: member listing is a plain envelope list, NOT keyset-paginated.

POST /campaigns/{id}/members
{"kind":"contact","id":"contact_k7m2q","reason":"matches the brief"}
200   OK attached contact_k7m2q to campaign_9x4kq
   IDEMPOTENT: re-posting the same (kind,id) is a 200 no-op, never a 409.
   errors: 400 bad_request  `Send JSON, e.g. {"kind":"contact","id":"contact_k7m2q","reason":"matches the brief"}.`
           400 invalid_field `"kind" must be "contact" or "company".`
           400 invalid_field `"id" did not match a contact in your workspace. Create or look it up first, then attach it.`
   audit: campaign.attach  target=campaign/<id>  detail=contact/<internal id>

DELETE /campaigns/{id}/members/{kind}/{memberId}
200   OK detached from campaign_9x4kq
   404 not_found "That entity is not a member of this campaign."   (detach is NOT idempotent — this is
   an asymmetry with attach, and arguably the wrong call: an agent retrying a detach gets an error.)
   audit: campaign.detach

# THE ONE-CALL SHORTCUT (the shape an agent research loop actually uses):
POST /contacts?campaign=campaign_9x4kq&reason=matches%20the%20brief
{"name":"Jane Doe","email":"jane@acme.com"}
-> upsert-or-create (§1.5) AND attach, in one call. Both halves are idempotent, so re-running the
   same loop over the same candidate set produces zero duplicates and zero errors.
   Also available on POST /companies. The campaign ref is resolved BEFORE any write, so a bad
   ?campaign= yields 400 invalid_field with no record created.
```

**Model:**
- `Campaign`: `Name`, `Description` (explicitly documented as "the free-text brief: what this campaign is for" —
  i.e., campaigns are modeled as **prospecting/research objectives an agent works against**, not an outreach
  send-mechanism), `Status` ∈ `{active, paused, done}`, `MemberCounts map[string]int` (e.g.
  `{"contact":47,"company":12}`) populated on single-record fetch only, described as "what a 'fill N contacts'
  objective measures" — i.e., the whole point of the counts is to let an agent self-report progress against a goal
  without a separate aggregate query.
- `CampaignMember`: `(Kind, ID)` pointing at a contact or company, plus `Reason` (free-text provenance — *why* this
  entity was gathered), `AddedBy`, `AddedAt`. Comment: **"Membership is many-to-many... and deduped per campaign,
  so an agent re-finding the same contact never double-counts."**
- **Explicitly not an outreach channel yet**: comment states "It is an anchor for agent work, not an outreach
  channel — an email/outreach object attaches to a campaign later" — i.e., crmkit's authors deliberately scoped
  Campaign to *collection*, leaving send/sequencing for a future layer they hadn't built.

**Wire-level idempotency, the standout decision:** `POST /campaigns/{id}/members {"kind":"contact","id":"contact_k7m2q","reason":"matches the brief"}`
is **idempotent by design** — re-attaching an already-member entity is a free no-op (`attachToCampaign` comment:
"The attach is idempotent, so re-running a create with the same campaign is a free no-op"). Combined with the
upsert-on-email create (§1.5), there's a **documented one-call shortcut**: `POST /contacts?campaign=campaign_..&reason=..`
creates-or-upserts the contact **and** attaches it to the campaign in a single call — the exact shape an agent
running a repeated "find people matching this brief" loop needs (call the same create-with-campaign-param endpoint
on every candidate found; duplicates and re-finds are all free no-ops, never errors).

**Disposition: BUILD NOW.** This is a genuinely good, minimal model for "AI-driven research/target-list build-up"
that maps directly onto the charter's "autonomous account monitoring" and "lead to qualified opportunity" workflows
— a `Campaign` is essentially a lightweight `AgentTask` target list with human-readable intent (the `Description`
brief) and idempotent membership. Recommendation: build as a SeaRM custom object (or a first-class object, same
open question as Ticket) with (a) the free-text brief field, (b) many-to-many deduped membership to person/company
records with a `reason` provenance field, (c) idempotent attach semantics on the corresponding GraphQL mutation
(attach is a no-op, not an error, if already attached), (d) the create-with-attach shortcut pattern applied to
SeaRM's record-creation mutations when a target campaign is specified. This directly powers "Autonomous account
monitoring" and target-account-list building in Phase 2/3.

---

### 1.14 Generic single-tool MCP surface: "request" replays the plain-text HTTP API (rank: MEDIUM — architecturally interesting, mixed verdict)

**File:** `internal/server/mcp_tools.go`, `internal/server/handlers_mcp.go:209-264`.

**Design:** crmkit exposes **exactly one MCP tool**, `request(method, path, body?)`, whose description is a
compressed operating manual (reproduced verbatim in `requestDescription`, `mcp_tools.go:60-86`) always loaded by
the client, plus `GET /help` for the full manual on demand. Every call is validated against an **explicit
allowlist of path prefixes** (`allowedPrefixes`, `mcp_tools.go:41-55`) that deliberately excludes `/auth/*`,
`/oauth/*`, `/mcp` itself, and well-known/health routes — so **the model cannot reach the authentication or
authorization plane through the tool it's authenticated with**, even though the underlying route table technically
has those routes. The call is then replayed via `httptest.NewRequest` against the **same internal handler chain**
real HTTP traffic uses (`dispatchInternal`), with the already-resolved session injected via context so the token
isn't re-parsed — i.e., **MCP is not a separate implementation of the API, it's the same API dispatched through a
different transport wrapper.**

**The exact `tools/list` entry** (`mcp_tools.go:89-156`):
```json
{
  "name": "request",
  "title": "Call the crmkit API",
  "description": "<requestDescription, reproduced below>",
  "inputSchema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["method", "path"],
    "properties": {
      "method": { "type": "string", "enum": ["GET","POST","PATCH","DELETE"], "description": "HTTP method." },
      "path":   { "type": "string", "description": "API path beginning with '/', including any query string (e.g. /contacts?stage=lead&limit=10, or /contacts/c_ab12)." },
      "body":   { "type": "object", "description": "JSON request body for POST/PATCH; omit for GET/DELETE." }
    }
  },
  "annotations": { "title": "Call the crmkit API", "readOnlyHint": false, "destructiveHint": true, "openWorldHint": false }
}
```
All three annotation hints are emitted **explicitly, true or false** — the comment notes directories such as the
OpenAI apps store require them present, not merely when true. Worth copying regardless of the tool shape.

**The exact `tools/call` result** (`mcpTextResult`): always a single text block, never structured content —
```json
{ "content": [ { "type": "text", "text": "<the plain-text HTTP body, verbatim>" } ], "isError": false }
```
`isError` is `true` when the replayed request returned **status ≥ 400**, or when argument validation failed
(in which case `text` is the validation message, e.g. `path "/oauth/token" is not permitted via MCP; allowed
prefixes: /whoami /search /contacts …`). Argument errors are deliberately returned as tool errors, not JSON-RPC
protocol errors, "so the model can read the message and retry."

**The allowlist, verbatim and complete** (`allowedPrefixes`, matched as exact-equal or `prefix + "/"`):
```
/whoami  /search  /contacts  /companies  /deals  /tasks  /campaigns
/activities  /reminders  /audit  /workspaces  /tokens  /help
```
**Fidelity note found while deepening this report: `/tickets` is NOT in the allowlist.** The ticket entity, its
CRUD, and its conversation endpoints are fully implemented in HTTP and completely unreachable through the MCP
tool. Either an oversight or an unstated scope decision — but it means crmkit's own agent surface cannot touch
tickets, which materially weakens "ticket workflow model" as a *proven* agent capability. Treat §1.12 as a data
model worth copying, not as a validated agent workflow.

**The tool description (`requestDescription`), reproduced verbatim** — this is the compressed operating manual
the model always has in context, and it is the single most transferable artifact in this file:
```
Operate the crmkit CRM through its plain-text HTTP API. You are already authenticated for one workspace.
Responses are grepable text (one labeled line per record) unless you add ?format=json; records are addressed by a handle like contact/c_ab12 - use the bare id (c_ab12) in paths.

Core:
  GET  /whoami                     identity, plan, usage
  GET  /search?q=acme              find anything across contacts, companies & deals (grouped)
  GET  /contacts|/companies|/deals list/query (see filters below)
  POST /contacts|/companies|/deals create; POST upserts contacts by email, companies by domain
  GET|PATCH|DELETE /contacts/{id}  fetch / update / delete one (same for companies, deals)
  POST /contacts/{id}/activities   log a call|email|meeting|note|task  {"kind":...,"body":...}
  GET|POST /tasks                  list / create follow-up work  {"title":..,"due_at":..,"contact_id":..}; PATCH /tasks/{id} {"done":true} to complete
  GET  /reminders                  open tasks due now/overdue (?days=N looks ahead)

Campaigns (a prospecting effort - a brief plus the contacts/companies gathered under it):
  GET|POST /campaigns              list / create  {"name":...,"description":"what you're collecting & why"}
  GET|PATCH|DELETE /campaigns/{id} fetch (shows member counts) / update status / delete
  GET  /campaigns/{id}/members     contacts & companies in the campaign
  POST /campaigns/{id}/members     attach one {"kind":"contact","id":"contact_..","reason":".."}; idempotent, so re-finding the same contact is free
  DELETE /campaigns/{id}/members/{kind}/{id}   detach one
Shortcut: POST /contacts?campaign=campaign_..&reason=.. (and /companies) creates/upserts AND attaches in one call.
Workflow: open a campaign, then upsert contacts/companies straight into it via ?campaign=. Re-check GET /campaigns/{id} for progress; the same entity can be in several campaigns.

List filters: ?field=value or ?field=op:value (ops: eq ne gt gte lt lte like in is not), plus &search= &sort=-field &limit= &cursor= .
Lists end with "# total: N" (rows matching your filters, across all pages) and, when more remain, "# next: <cursor>" to pass as &cursor=. Use total to decide whether to keep paging or narrow your filters.
DELETE is two-step: the first call returns a confirm token to resend as ?confirm=. Errors are instructive - they tell you what to do next.

Fetch the full manual any time: request GET /help
```
Structural features worth stealing wholesale: it states the auth/tenancy context in sentence one; it teaches the
*response format* before any endpoint; it groups by task rather than by resource; it names the two-step DELETE and
the pagination trailers inline; and it ends by pointing at the on-demand full manual instead of inlining it.

**Decision worth keeping (the strong part):** "one tool that IS the API" instead of "N tools, one per endpoint,"
plus the compressed-manual-in-description + full-manual-on-GET/help pattern, plus dispatching MCP calls through
the exact same internal handler code path as HTTP (zero drift between what HTTP does and what MCP does — a bug fix
or new endpoint is automatically available to both transports with no duplication).

**Decision to *not* keep as-is (the weak part, and the file's own comments admit it):** the tool is necessarily
annotated `readOnlyHint: false, destructiveHint: true` for *every* call, because a single generic tool spans every
HTTP verb including DELETE — this is exactly the shape MCP client directories/marketplaces increasingly reject or
downgrade (a tool that can't self-declare "this particular call was read-only" fails the safety-triage UX most MCP
hosts now build for users, and it's a poor fit for the charter's per-tool granular audit/approval requirements).
The file's own comment flags this as a known compromise ("Directories that require a single safe/unsafe split per
tool should use the purpose-built connectors instead").

**Disposition: SPLIT.**
- **BUILD NOW:** the allowlist-of-reachable-surface pattern (auth/authz endpoints unreachable by construction
  through the agent tool, even if technically routable) — apply this directly to SeaRM's MCP tool surface: the
  agent's tool set must never include SeaRM's own session/SSO/admin endpoints. Also build the "manual in tool
  description + full docs on demand" pattern for onboarding a model to SeaRM's schema quickly.
- **DEFER / reject the single-generic-tool shape:** SeaRM should expose purpose-built, per-operation MCP tools
  (read record, search, propose-create, propose-update, propose-delete, list-schema, etc.) each individually
  annotated `readOnlyHint`/`destructiveHint` correctly — this is *more* work than crmkit's one-tool trick but is
  required both by the charter (Proposal contract needs per-action typing: create/update/delete/send are distinct
  `ProposalItem` types, not an opaque HTTP verb) and by MCP ecosystem best practice. **Trigger:** none needed —
  this is a straightforward "don't copy" call, not a deferred-pending-signal item.

---

### 1.15 MCP initialize handshake + server-declared instructions field (rank: LOW-MEDIUM, small but free)

**File:** `internal/server/handlers_mcp.go:186-207`.

**Exact `initialize` result** (`handlers_mcp.go:189-207`):
```json
{
  "protocolVersion": "<echoed from the client's request; falls back to the server's own constant if absent>",
  "capabilities": { "tools": { "listChanged": false } },
  "serverInfo": { "name": "crmkit", "version": "<build version>" },
  "instructions": "crmkit is an agent-first CRM. It exposes a single tool, `request`, that calls the CRM's plain-text HTTP API (method + path + optional body) - read that tool's description, and call `request` with GET /help for the full manual. Results are plain text; records are addressed by a handle like contact/c_ab12."
}
```
The rest of the JSON-RPC surface, complete: `initialize`, `ping` (returns `{}`), `tools/list`, `tools/call`, and
the three notifications `notifications/initialized|cancelled|progress` which return **no body at all** (HTTP 202
for a notification with no `id`). Anything else → `{"code": -32601, "message": "method not found: <m>"}`.
Requests with no `id` (or `id: null`) are treated as notifications and never answered.

Echoes the client's requested `protocolVersion` back verbatim when present (maximizes compatibility across MCP
protocol versions rather than forcing crmkit's own default), declares `capabilities.tools.listChanged: false`
(honest — the tool set truly never changes at runtime for crmkit), and ships a short `instructions` string in the
initialize result that primes the model before its first `tools/list` call.

**Disposition: BUILD NOW** — trivial, correct MCP protocol hygiene; carry the version-echo and honest
capability-declaration practice into SeaRM's MCP server regardless of anything else in this report.

---

### 1.16 Audit log with structured, computed diffs (rank: MEDIUM — feeds directly into charter's Principal contract)

**File:** `internal/server/diff.go`, `s.audit(...)` calls throughout `handlers_crm.go`, `handleListAudit` (`handlers_crm.go:1341`).

**Wire format:** `GET /audit?target=contact_ab12` →
```
audit/a_9k2  by=alice@acme.com action=contact.update target=contact/c_ab12 detail="stage: lead -> customer; owner: (none) -> alice" at=2026-08-05T10:03:00Z
```

**Exact line format and query surface** (`handleListAudit`, `handlers_crm.go:1341-1363`):
```http
GET /audit?target=contact_ab12&by=alice@acme.com&limit=50
200 (text)
audit/a_9k2  by=alice@acme.com action=contact.update target=contact/c_ab12 detail="stage: lead -> customer; owner: (none) -> alice" at=2026-08-05T10:03Z
# 1 audit entry(ies)
```
JSON mode returns `{"items":[<AuditEntry>...], "next_cursor":""}` — **no `total`, no cursor**: audit is an
envelope list, not keyset-paginated. `?target=` accepts a record reference for kinds
`contact|company|deal|ticket|task` and is resolved to the stored `kind/<internal-id>` form before matching;
anything else is matched literally. `?by=` matches the actor email exactly.

**The complete action vocabulary** (29 verbs, grepped exhaustively — this is the whole closed set):
```
contact.create   contact.update   contact.upsert   contact.delete
company.create   company.update   company.upsert   company.delete
deal.create      deal.update      deal.delete
ticket.create    ticket.update    ticket.delete
task.create      task.update      task.delete
activity.create  activity.delete
campaign.create  campaign.update  campaign.delete  campaign.attach  campaign.detach
member.invite    member.remove    member.role
workspace.create workspace.timezone
token.revoke     oauth.token
```
Note there is **no `*.read` verb** — audit records writes only; and `oauth.token` is the sole entry written
outside a normal user session (target `token/<id>`, detail `mcp:<client_id>`).

**The exact diff-field whitelists** (`diff.go`) — the fields deemed "meaningful enough to show":
| Entity | Fields diffed (in order) |
|---|---|
| contact | name, email, phone, stage, owner, company (resolved name, falling back to handle), tags (comma-joined) |
| company | name, domain, tags |
| deal | title, stage, status, amount (cents/100, 2dp), contact, company |
| ticket | subject, status, assignee, requester, tags |
| task | title, status (`open`/`done`, derived from `DoneAt != nil`), due (`2006-01-02`), assignee |
Format: `field: before -> after`, joined with `; `; unchanged fields are skipped entirely; an empty/blank side
renders as `(none)`. If nothing meaningful changed the detail is the empty string — so an update that touches
only `notes` or `custom` records an audit row with **no detail at all**, which is a deliberate scannability
trade-off and also a real forensic gap worth fixing rather than copying (`notes`, `custom`, and follow-up fields
are explicitly excluded per the source comment).

**Decision worth keeping:** the audit `detail` string is a **computed semantic diff**, not a raw before/after JSON
blob — `diffContact`/`diffCompany`/`diffDeal`/`diffTicket`/`diffTask` (`diff.go`) each whitelist which fields are
"meaningful enough to show" (explicitly *excluding* long/low-signal fields like notes and custom JSON — comment:
"Long/low-signal fields... are intentionally omitted to keep history scannable") and format only the fields that
actually changed as `"field: before -> after"`, joined with `; `. Every audit action string is a dotted
`entity.verb` taxonomy (`contact.create`, `contact.update`, `contact.upsert`, `contact.delete`, `campaign.attach`,
`oauth.token`, `member.role`, `token.revoke`, ...) — a closed, greppable vocabulary rather than free text.
`by` is always the resolved actor email (never a raw token or id), and `target` is the stable `kind/internal-id`
form (§1.6) so history for a record survives even if its short handle were ever regenerated.

**Disposition: BUILD NOW** as a design pattern layered onto SeaRM's existing audit/activity infrastructure (SeaRM
already has an audit trail per the charter's "Preserve SeaRM as the system of record" list). What's specifically
worth adding if not already present: (a) the **field-level before→after diff computation on write**, curated per
entity to exclude noisy fields, rather than dumping full record snapshots; (b) a closed `entity.verb` action-name
taxonomy for greppability; (c) explicitly distinguishing `.upsert` from `.create`/`.update` as its own audit verb
so history shows *which code path* produced a change, not just that a change occurred — useful forensic signal
when debugging duplicate-prevention behavior.

---

### 1.17 `on_behalf_of` — a second, orthogonal principal axis for agent-performed actions (rank: MEDIUM-HIGH — directly relevant to charter's Principal contract, an idea not obviously present elsewhere in the audit)

**File:** `internal/protocol/protocol.go:420-427` (`Activity.OnBehalfOf`), used throughout `handlers_crm.go` and `query.go` (`?on_behalf_of=` filter, `contactBehalfExpr` etc.).

**The idea:** every logged `Activity` (call/email/meeting/note/task) carries **two separate identity fields**:
- `CreatedBy` — the literal actor that wrote the row: a human's session email, or an **agent's token identity**
  (server-stamped, never client-supplied — "never trust a client-supplied value" appears verbatim as a comment on
  every `CreatedBy` assignment).
- `OnBehalfOf` — a free-text (client-supplied, by convention an email) principal the action was **performed for**
  — e.g., an agent acting as a rep's assistant logs `CreatedBy: agent-token@..., OnBehalfOf: alice@acme.com` when
  it drafts and logs a call on Alice's behalf. Comment: *"OnBehalfOf is the principal this interaction was
  performed for... a separate axis from CreatedBy: CreatedBy is the actor that wrote the row..., OnBehalfOf is who
  it was done for."* Crucially, `OnBehalfOf` can name **someone without a crmkit account at all** — it's not a
  foreign key, just an identifying string, because the person being represented might not be a system user.

Records themselves roll this up for display: `OnBehalfOf []string` on `Contact`/`Company`/`Deal`/`Ticket` is
**derived** (never stored) from the distinct `on_behalf_of` values across that record's activity log — "the set of
principals work has been done for." This is filterable (`?on_behalf_of=alice@acme.com`) via the derived EXISTS
predicates in §1.9.

**Exact wire behaviour:**
```http
POST /contacts/{id}/activities
{"kind":"call","body":"Walked through pricing","on_behalf_of":"alice@acme.com"}
201
activity_p3q8m  contact=contact_k7m2q kind=call body="Walked through pricing" on_behalf_of=alice@acme.com by=agent-token@acme.com at=2026-08-05T10:03Z
```
- `on_behalf_of` is **client-supplied and unvalidated** — any string, no FK, no membership check. That is the
  point (the represented principal may have no account), and also the reason it can never be an authorization
  input, only an attribution one.
- `created_by` on the same row is **server-stamped from the session** and is not accepted from the body.
- The record-level rollup is derived, never stored: `ActivityPrincipalsBatch(ws, kind, ids)` returns the distinct
  `on_behalf_of` values per record, assigned to `Contact/Company/Deal/Ticket.OnBehalfOf []string` on read.
  It renders as `on_behalf_of=alice@acme.com,bob@acme.com` in list lines and `on_behalf_of: alice, bob` in detail
  blocks, and is **omitted entirely when empty**.
- Filtering is the `EXISTS` predicate in §1.9, case-insensitive on both sides
  (`lower(a.on_behalf_of) = lower(?)`), available on contact/company/deal/ticket and **not** on task/campaign
  (they have no activity log). Activity listing takes it directly: `GET /activities?on_behalf_of=alice@acme.com`,
  and per-record: `GET /tickets/{id}/activities?on_behalf_of=…`.

**Why this matters for the charter specifically:** the charter's Principal contract requires "audit entries
distinguish authenticated user, represented user/team, workflow, agent, and integration" — crmkit's
`CreatedBy`/`OnBehalfOf` split is **exactly** this distinction, independently arrived at, and is a genuinely
under-obvious design (most CRMs only have one "who did this" field). It is the single most charter-relevant idea in
this codebase that isn't already called out by name in the charter's own bullet list.

**Disposition: BUILD NOW — high priority, currently under-weighted relative to its value.** This should be
elevated in the plan explicitly: every write path that can be agent-originated (proposal execution, workflow
action, evidence extraction) needs both "which agent/token/workflow actually performed this write" (already
covered by existing `AgentRun`/audit machinery per the charter) **and** an independent "which human/team this work
was represented as/for" field, because those are genuinely different questions an auditor or a rep will ask
("did the AI do this?" vs. "whose account did this affect/was this framed as?"). Recommend adding an explicit
`representedPrincipal`/`onBehalfOf` axis to SeaRM's Activity/Timeline and to the `Proposal`/audit event shape,
separate from the existing agent/workflow/user actor field.

---

### 1.18 Timezone-aware read-time localization, UTC-only storage (rank: LOW — solid but unremarkable engineering hygiene)

**File:** `internal/protocol/protocol.go:432-531` (`Localized` methods per entity), `Workspace.Timezone`.

Every entity has a `.Localized(loc)` method converting only its *display* — instants are always stored/compared in
UTC; a workspace's IANA timezone is resolved once per session and threaded through reads to format timestamps in
the workspace's local time without ever touching what's stored. Simple, correct, unglamorous.

**Mechanism, completely** (`protocol.go:432-531`): `Workspace.Timezone` is an IANA name defaulting to `"UTC"`;
it is resolved when the bearer token is resolved and carried on the session as
`Session.WorkspaceTimezone` (so reads need no extra lookup). `Localized(loc)` exists on `Contact`, `Company`,
`Deal`, `Ticket`, `Task`, `Campaign`, `CampaignMember`, `Activity`, `Reminder`, `Member`, `Workspace` — each
returns a **value copy** with `t.In(loc)` applied to its own instants only (`inLoc` no-ops a zero time or nil
location; `inLocPtr` handles the nullable ones). Handlers call `c = c.Localized(locationOf(sess))` immediately
before rendering, and `localizedSlice(list, loc)` for pages. Rendering then uses `render.Stamp` (see §1.7),
which formats in the value's own location — so the localization decision lives entirely at the call site and the
renderer stays location-agnostic. Storage, filtering (`colTime` → Unix seconds), and cursor values are all UTC.

**Disposition: DEFER — no action needed.** SeaRM already has to solve workspace-timezone display somewhere in its
existing UI/API layer; there is nothing crmkit does here that isn't standard practice. Not worth a scouting
recommendation beyond noting it's correctly done (store UTC, localize at read).

---

### 1.19 Dual-dialect SQL store abstraction (SQLite for local/dev, PostgreSQL for prod) via a small `dialect` interface (rank: LOW for SeaRM — architecture mismatch)

**Files:** `internal/store/dialect.go`, `internal/store/sqlite.go`, `internal/store/postgres.go`.

crmkit runs the identical query-building code (`query.go`, `crm.go`) against either backend by abstracting only the
handful of syntax differences (`LIKE` vs `ILIKE`, JSON extraction functions, etc.) behind a tiny `dialect` struct,
rather than using an ORM. This lets a self-hoster run zero-dependency SQLite while cloud runs Postgres, off one
codebase.

**Disposition: DROP — architecture mismatch, not applicable.** SeaRM is already Postgres-only via TypeORM/NestJS
with a mature multi-tenant schema-per-workspace (or row-level, per SeaRM's actual implementation) model; a
hand-rolled dual-dialect layer solves a problem SeaRM doesn't have and SeaRM's ORM already solves better for its
stack. No trigger to revisit — this is a permanent no, not a deferred maybe.

---

## 2. Wire-format quick reference (for implementers who skip straight to this section)

**This report is now the source of truth: every wire format below is recorded in full in §1, so the crmkit
repository can be deleted without losing anything reimplementable.** Per-section pointers: error codes §1.1 ·
confirm tokens §1.2 · escalation §1.3 · versioning §1.4 · upsert §1.5 · id/handle codec §1.6 · text/JSON
rendering §1.7 · cursors §1.8 · filter grammar and whitelists §1.9 · OAuth bodies §1.10 · quotas and `/whoami`
§1.11 · Ticket §1.12 · Campaign §1.13 · MCP tool schema and manual §1.14 · `initialize` §1.15 · audit §1.16 ·
`on_behalf_of` §1.17.

```
# Error envelope (render.go) — CRM plane
{ "error": "<code>", "hint": "<imperative recovery instruction>" }
ERROR <code>
HINT  <imperative recovery instruction>          # two spaces after HINT

# Error envelope — /oauth/* plane only (RFC 6749)
{ "error": "invalid_grant", "error_description": "PKCE verification failed." }

# Error envelope — POST /mcp transport (JSON-RPC)
{ "jsonrpc": "2.0", "error": { "code": -32600, "message": "auth_required", "data": "<desc>" } }

# Delete confirmation (handlers_crm.go)
DELETE /contacts/{id}            -> 409 confirmation_required, hint carries "?confirm=<token>"
DELETE /contacts/{id}?confirm=X  -> 200 OK deleted <ref>

# Optimistic concurrency (protocol.go, handlers_crm.go)
GET  /contacts/{id}              -> {"version": N, ...}
PATCH /contacts/{id}             If-Match: "N"   OR   body {"version": N, ...}
                                  -> 412 version_conflict if N is stale

# Upsert-on-natural-key (handlers_crm.go)
POST /contacts {"email": "x@y.com", ...}  -> 200 + "# updated" (existing match)
                                           -> 201 + "# created" (no match)
                                           -> 409 ambiguous_match (>1 match)

# Cursor pagination (store/query.go)
GET /contacts?sort=-updated_at&limit=50
  -> "# total: 842" / "# next: <opaque base64url cursor>" trailers (or JSON total/next_cursor)

# OAuth bootstrap (handlers_oauth.go)
POST /mcp (no bearer)   -> 401, WWW-Authenticate: Bearer resource_metadata="<.well-known URL>"
GET  /.well-known/oauth-protected-resource        -> {resource, authorization_servers, ...}
GET  /.well-known/oauth-authorization-server      -> {authorization_endpoint, token_endpoint, ...}
POST /oauth/register   (DCR)                      -> {client_id, redirect_uris, ...}
GET/POST /oauth/authorize                          -> email OTP -> workspace pick -> redirect w/ code
POST /oauth/token      (authorization_code + PKCE) -> {access_token, refresh_token, token_type:"Bearer"}
POST /oauth/token      (refresh_token, rotating)   -> new pair; old access token explicitly revoked
POST /oauth/revoke                                  -> 200 always (RFC 7009)

# Escalation step-up (handlers_escalation.go)
PATCH /workspaces/{id}/members/{userId}/role {"role":"admin"}
  -> 403 escalation_required (code emailed) on first call
  -> repeat with ?code=NNNNNN -> 200 OK

# Campaign idempotent attach + shortcut (handlers_campaign.go)
POST /campaigns/{id}/members {"kind":"contact","id":"...","reason":"..."}   -> idempotent no-op if already member
DELETE /campaigns/{id}/members/{kind}/{memberId}                            -> 404 if not a member (NOT idempotent)
POST /contacts?campaign={id}&reason=...                                     -> create/upsert + attach, one call

# Ticket (protocol.go, handlers_crm.go:927-1130)
GET|POST /tickets                       status ∈ open|pending|solved ("" -> open); subject required
GET|PATCH|DELETE /tickets/{id}          PATCH merges; DELETE is confirm-gated
GET|POST /tickets/{id}/activities       the conversation IS the generic activity log filtered by ticket_id
  !! /tickets is absent from the MCP allowlist — unreachable by the agent tool (see §1.14)

# Plain-text rendering contract (render.go)
Line:   "<ref>  key=val key=\"quoted if it has a space/tab/quote\""   empty values omitted
Record: "key:<pad to max+1>  value" per line, empty values omitted
Stamp:  "2006-01-02T15:04Z07:00"  (RFC3339 to the minute, in the value's own location)
Lists:  "# N <kind>(s)" (page size) then "# total: N" (filter-wide) then "# next: <cursor>"
Negotiation: ?format=json > ?format=text > Accept: application/json > plain text (default)

# Filter grammar (server/query.go)
?field=value | ?field=<op>:value      op ∈ eq ne gt gte lt lte like in is not
?tags=a,b (AND-ed)   ?custom.<key>=[eq:|like:]value   ?on_behalf_of=<email>   ?search=  ?sort=[-]field
reserved (never filters): sort limit cursor search format tags
limit default 50, clamped [1,200]

# Audit (handlers_crm.go:1341)
GET /audit?target=contact_ab12&by=alice@acme.com&limit=50
audit/a_9k2  by=… action=<entity.verb> target=<kind>/<internal id> detail="f: before -> after; …" at=…

# MCP (mcp_tools.go, handlers_mcp.go)
tools/list  -> one tool "request" {method: GET|POST|PATCH|DELETE, path, body?}
               annotations {readOnlyHint:false, destructiveHint:true, openWorldHint:false}
tools/call  -> { "content": [{"type":"text","text":"<raw HTTP body>"}], "isError": <status>=400> }
allowlist   -> /whoami /search /contacts /companies /deals /tasks /campaigns
               /activities /reminders /audit /workspaces /tokens /help
```

---

## 3. Explicit "not worth porting" list (required by the charter — no silent drops)

| Capability | Where | Reason |
|---|---|---|
| Dual SQLite/PostgreSQL store dialect abstraction | `internal/store/dialect.go`, `sqlite.go`, `postgres.go` | Architecture mismatch — SeaRM is Postgres/TypeORM already; solves a problem SeaRM doesn't have. |
| Plain-text-by-default HTTP content negotiation (`render.WantJSON`/`Respond`) as a whole-API transport | `internal/render/render.go` | SeaRM's transport is GraphQL; a parallel plain-text API is real ongoing surface cost. Compact output belongs at the MCP tool-response layer instead (see §1.7 disposition). |
| Free-text query-string filter DSL (`?field=op:value`) as literal implementation | `internal/server/query.go` | GraphQL's typed filter/orderBy inputs already parameterize by construction; the SQL-identifier-injection problem this DSL solves is largely moot on a typed schema. Keep only the whitelist-and-teach-in-error *principle* for the MCP layer. |
| Internal-id vs. handle two-tier identifier scheme, in full | `internal/protocol/protocol.go` `NewID`/`NewHandle` | SeaRM already has UUID PKs; a second internal-id layer is pure duplication. Only the *short agent-facing alias* idea is worth keeping, scoped to the MCP surface. |
| Email-OTP login as the *general* auth mechanism | `internal/auth/*`, `handlers_auth.go` | SeaRM already has its own auth/SSO; crmkit's OTP flow exists only because crmkit has no other login system. Reuse SeaRM's login inside the ported OAuth-AS flow (§1.10) instead of porting OTP. |
| Single-tenant-workspace-per-token bearer model as the whole auth story | Repo-wide | SeaRM is natively multi-tenant with roles/permissions/SSO; crmkit's bearer-token-is-the-whole-security-model is strictly weaker and is superseded by SeaRM's existing permission system — only the *OAuth issuance flow* around it (§1.10) is worth taking, not the token-is-authority model itself. |
| Workspace plan/quota subsystem as a literal parallel implementation | `internal/server/quota.go` | SeaRM's billing/entitlements system is already the system of record for this; duplicating it here would fight the charter's "Preserve SeaRM as the system of record" mandate. |
| `assignee`/`owner` as bare free-text email strings (not FKs) | `protocol.go` Contact/Ticket/Task | Reasonable in a single-tenant Go service with no real user/permission model; actively wrong for SeaRM, which has real workspace members with roles and permissions — assignee should be a proper member reference. Flagged explicitly under Ticket (§1.12) as a rejected sub-decision. |
| Timezone localization pattern | `protocol.go` `Localized()` | Already-standard practice; SeaRM already needs to solve this somewhere. Nothing novel to port. |
| Single generic MCP `request` tool as the tool-surface shape | `mcp_tools.go` | Fails per-tool safety annotation granularity that MCP hosts/directories and the charter's Proposal typing both require. The file's own comments flag this as a known compromise for a single-agent private CRM, not a target design. Keep only the allowlist-of-reachable-routes and manual-in-description sub-patterns. |
| crmkit's specific ticket lifecycle enum (`open/pending/solved`) as final | `protocol.go` Ticket.Status | Explicitly marked incomplete by crmkit's own comments ("on-hold, closed and the full lifecycle come later"). Worth using as a starting point, not as the finished state machine — a support-ticket vertical app should design its own complete lifecycle. |
| Campaign as *only* a collection anchor, no outreach/send mechanism | `protocol.go` Campaign comment | This is crmkit's own acknowledged scope gap ("an email/outreach object attaches to a campaign later" — never built). Not a rejection of the Campaign model itself (§1.13 is BUILD NOW) — flagged here so nobody mistakes the *absence* of outreach/sequencing in crmkit's Campaign for a design decision; it's an unfinished feature, and SeaRM's own workflow/outreach mechanisms should fill that gap rather than waiting for a crmkit pattern that doesn't exist yet. |

No capability found during this scout was excluded from both §1 (inventory + disposition) and this table.
