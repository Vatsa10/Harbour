# Agent API Contract

This document describes the machine-readable contract Twenty's tool layer (chat, agent runs, MCP, `execute_tool`, and workflow AI-agent steps) guarantees to any caller — human-authored client, internal agent, or external OAuth-authorized MCP client.

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

Deletes under the default `PROPOSE` policy do not need a confirm token — the human approval step in the proposal inbox already is the confirmation.

Human-initiated deletes through the ordinary product UI are entirely unaffected by this — confirmation tokens exist only on the AI tool-call path.

## Failure shape

Every failure this contract governs — from the gate, the tool executor, the tool registry, or the MCP transport — includes, in addition to the legacy `success`/`error`/`message` fields:

```json
{
  "success": false,
  "message": "...",
  "error": "...",
  "failure": {
    "code": "NOT_FOUND | UNKNOWN_TOOL | INVALID_ARGUMENTS | FORBIDDEN_BY_POLICY | PERMISSION_DENIED | CONFIRMATION_REQUIRED | DUPLICATE_PROPOSAL | RATE_LIMITED | INTERNAL_ERROR",
    "message": "...",
    "hint": "an imperative sentence describing exactly what to do next",
    "retryable": true,
    "allowedActions": ["retry", "get_tool_catalog", "..."]
  }
}
```

`retryable: false` means retrying the identical call will not succeed — stop and either change the request or ask a human. `retryable: true` means a transient condition (a dropped connection, a wrong confirmation token) may resolve on a corrected retry.

## Workflow templates

Three starter workflow templates (`workflowTemplates` GraphQL query) package the research and proposal capabilities above into ready-to-install automations: research brief, follow-up digest, and weekly account monitoring. Install one with `installWorkflowTemplate`; it is created as a `DRAFT` workflow you can inspect and edit in the workflow builder before activating.
