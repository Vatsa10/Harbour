# Agent API Contract

This document describes the machine-readable contract SeaRM's tool layer (chat, agent runs, MCP, `execute_tool`, and workflow AI-agent steps) guarantees to any caller — human-authored client, internal agent, or external OAuth-authorized MCP client.

## Authentication and scope

MCP clients authenticate via OAuth 2.1 (RFC 9728 discovery, RFC 7591 dynamic client registration, PKCE-only public clients — see `engine/core-modules/application/application-oauth/`). A token is minted against exactly one workspace and one role, chosen during the authorize flow, and never silently expands to a workspace added later. Every tool call — CRUD, metadata discovery, or write proposal — is scoped by that role's object, field, and row-level permissions. There is no separate "MCP scope" system: the OAuth `scope` parameter is a thin consent label (`api`, `profile`); the actual boundary is the assigned role, enforced by the same permission checks a human user of that role would hit.

## Discovering what you can do

Call `get_tool_catalog` first. It returns only tools your role can currently use — a role with no object permissions on `person` never sees `find_many_people` in its catalog. Call `get_object_metadata` (`includeFields: true`) to see each object's fields and your `permittedOperations: {read, write, delete}` for it before attempting a write.

## Reading records

`find_many_<object>` is stably paginated: results are always ordered with `id` appended as a tiebreaker, so concurrent writes never shuffle a page you've already fetched. Every result carries `count` (total matches) and `hasMore` (whether another page exists) — check `hasMore`, not the page size, before deciding whether to keep paging.

## Writing records

Every write (`create_*`, `update_*`, `delete_*`, `send_email`, `create_calendar_event`) is evaluated by a per-workspace policy before it executes:

- **AUTO** — executes immediately, exactly like a human using the same permissions.
- **PROPOSE** (the default) — the call returns `success: true` with a `PENDING` proposal id. **Do not retry.** The change applies only after a human approves it in the AI approvals inbox.
- **FORBID** — the call returns `success: false` with a `FORBIDDEN_BY_POLICY` failure. Do not retry; ask a human to change the policy or make the change directly.

An identical write retried inside the same conversation/turn is deduplicated automatically — you will get back the same pending proposal id, not a second one.

## Deleting records

AI-requested deletes under an `AUTO`-mode policy require a two-call confirmation round trip, independent of the proposal system above:

1. Call `delete_one_<object>` (or `delete_many_<object>`) without `confirm`.
2. The response is a `CONFIRMATION_REQUIRED` failure whose `hint` names the exact token to pass.
3. Repeat the identical call with `confirm: "<token>"` set.

**What this control is, precisely.** The token is a deterministic hash of the
workspace, object and delete basis — the record id for `delete_one`, the
canonicalized filter for `delete_many`. It is not keyed by a server secret, has
no TTL, and is not bound to a human turn: the failure response hands the agent
the token it needs, so an agent satisfies the gate by calling twice. It is a
**speed bump against one-shot model mistakes and against silently widening a
delete** — a token minted for one record or one filter is rejected for any
other — and it is deliberately *not* human-in-the-loop. Human review of a
delete comes from the default `PROPOSE` policy, not from this token.

Deletes under the default `PROPOSE` policy do not need a confirm token — the human approval step in the proposal inbox already is the confirmation.

Human-initiated deletes through the ordinary product UI are entirely unaffected by this — confirmation tokens exist only on the AI tool-call path.

## Failure shape

Every failure returned by `ToolExecutorService.dispatch` — whether authored by
the gate, the tool executor, the tool registry or the MCP transport, or raised
as a bare string by an underlying record-crud service or static tool and
classified on the way out — includes, in addition to the legacy
`success`/`error`/`message` fields:

```json
{
  "success": false,
  "message": "...",
  "error": "...",
  "failure": {
    "code": "NOT_FOUND | UNKNOWN_TOOL | INVALID_ARGUMENTS | FORBIDDEN_BY_POLICY | PERMISSION_DENIED | CONFIRMATION_REQUIRED | INTERNAL_ERROR",
    "message": "...",
    "hint": "an imperative sentence describing exactly what to do next",
    "retryable": true,
    "allowedActions": ["retry", "get_tool_catalog", "..."]
  }
}
```

`DUPLICATE_PROPOSAL` and `RATE_LIMITED` are declared in `ToolFailureCode` but
have no producer today; treat them as reserved rather than expected.

The legacy `error` string is deliberately `"<failure.message> <failure.hint>"`,
because today's agent-facing surfaces render `error` alone and would otherwise
drop the recovery path. **A consumer that renders `failure` must not also render
`error`** — it will print the message and the hint twice.

Each entry in `allowedActions` is either the name of a tool the agent may call
instead, or one of the three pseudo-actions `retry`,
`retry_with_confirm_token`, `ask_admin_to_change_policy`
(`TOOL_FAILURE_PSEUDO_ACTIONS`). Nothing else appears there.

Classification of an underlying tool's English error is best-effort: an
unrecognised message becomes `INTERNAL_ERROR` with `retryable: false`, never a
guess that invites a retry loop.

`retryable: false` means retrying the identical call will not succeed — stop and either change the request or ask a human. `retryable: true` means a transient condition (a dropped connection, a wrong confirmation token) may resolve on a corrected retry.

## Workflow templates

Three starter workflow templates (`workflowTemplates` GraphQL query) package the research and proposal capabilities above into ready-to-install automations: research brief, follow-up digest, and weekly account monitoring. Install one with `installWorkflowTemplate`; it is created as a `DRAFT` workflow you can inspect and edit in the workflow builder before activating.
