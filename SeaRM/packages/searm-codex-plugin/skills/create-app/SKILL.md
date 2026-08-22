---
name: create-app
description: Use when the user wants to create or scaffold a new SeaRM app
---

# When To Use

Pick this skill when the user wants to start a brand-new SeaRM app from scratch. Representative triggers:

- "I want to build a SeaRM app"
- "scaffold a new SeaRM app"
- "start a new SeaRM plugin / extension / integration"
- "create a CRM extension for SeaRM"
- "set up a SeaRM app project"
- "bootstrap a SeaRM app called X"

Do not use this skill when the app already exists — use `develop-app` to add features, `manage-app` for sync/deploy/troubleshooting, `publish-app` for marketplace prep, or `use-searm-mcp` to query workspace data.

# Quickstart an App

For background on how SeaRM apps work — the SDK packages, remotes, sync lifecycle, and rendering model — read `../../references/concepts/how-apps-work.md`.

Use this as the default way to start an app unless the user gives different instructions.

## Why A SeaRM Instance Is Needed

Before scaffolding, explain to the user that a SeaRM app is not a standalone application — it is a package that extends a running SeaRM instance. During development, the app's entities (objects, views, front components, logic functions) are synced to a SeaRM instance where they are registered, rendered, and executed. Without a connected instance, there is nothing to sync to, no workspace to test in, and no way to verify the app works.

## Choose A SeaRM Instance

By default, ask the user for the URL of their existing SeaRM instance (e.g. `https://app.searm.com` or a self-hosted URL). Mention that if they don't have one yet, you can spin up a local instance with Docker instead.

The two options are:

1. **Existing SeaRM instance (default)** — the user provides the URL of a running SeaRM server (self-hosted or cloud, e.g. `https://app.searm.com`). The scaffolder authenticates via OAuth on that instance. Best when the user already has a workspace with data they want to develop against.
2. **Local instance with Docker (fallback)** — only when the user has no SeaRM instance available. The scaffolder starts a disposable local SeaRM server on `http://localhost:2020` through Docker. Requires Docker Desktop to be installed and running.

If the user does not provide a URL, ask first whether they have a SeaRM instance URL to use; only fall back to Docker if they explicitly say they don't have one.

Before scaffolding, repeat back the app's purpose in one sentence and its expected shape: standard objects extended, any custom objects, whether it needs UI, whether it needs workflows or post-install seeding. Scaffolding is one-way — confirming here avoids re-scaffolds later.

## Scaffolding

First, ask the user for the app name if they did not provide one.

The directory name must contain only lowercase letters, numbers, and hyphens. Transform the entered name to lowercase and replace spaces with hyphens when needed.

For an existing SeaRM instance (default):

```bash
npx create-searm-app@latest <app-name> --url <searm-instance-url>
```

The `--url` flag authenticates via OAuth on the provided instance. The scaffolder opens a browser for the OAuth flow, then stores the credentials as a remote in `~/.searm/config.json`.

Only if the user has no SeaRM instance and wants to try locally with Docker:

```bash
npx create-searm-app@latest <app-name>
```

This omits `--url` and starts a disposable local SeaRM server through Docker.

The scaffolder handles everything: it creates the project, enables corepack, installs dependencies, initializes Git, authenticates with the target instance, runs an initial sync, and opens the generated app page when possible.

If the user provides a package name, display name, or description, pass them through:

```bash
npx create-searm-app@latest <app-directory> --name "<package-name>" --display-name "<display-name>" --description "<description>"
```

Supported create-time options are `--name`, `--display-name`, `--description`, `--url`, and `--authentication-method`.

## After Scaffolding

When the scaffolder completes, the app is fully created, synced, and installed. The job is done.

Do not run any follow-up validation commands after scaffolding unless the user asks for them. Do not run `yarn searm apply`, `yarn test`, `yarn lint`, or other validation just to prove the scaffold worked; the scaffolder already performed the initial sync. If the user asks to run tests later, switch to `develop-app` or `manage-app` guidance and run the full suite against the isolated test instance with `SEARM_API_URL=http://localhost:2021`.

Report to the user that the app was created successfully and is ready for development. Then stop. Wait for the user to ask for the next action.

The scaffolder generates a placeholder page at `src/front-components/main-page.tsx` plus its page layout and navigation menu item. In `develop-app`, delete all three before the first deploy unless the app actually needs UI. Do not stack additional pages on top of the placeholder.

## Docker Fallback Troubleshooting

Use this only when the user opted into the Docker fallback and it fails because Docker is missing or not running.

The preferred recovery is to ask the user for an existing SeaRM instance URL and rerun the scaffolder with `--url <searm-instance-url>` — this skips Docker entirely.

If the user still wants the local Docker path and Docker is missing, share this download link: `https://www.docker.com/products/docker-desktop/` and ask them to install Docker Desktop.

# Next Steps

Only proceed to these when the user explicitly asks:

- Use `develop-app` when the user wants to add objects, fields, logic functions, roles, views, navigation, page layouts, skills, agents, or front component registrations.
- Use `references/design/front-component-ui.md` when the user wants to design or improve the UI of a SeaRM front component.
- When the user later makes changes to app entities, use `yarn searm apply` to sync those changes. See the `manage-app` skill for sync workflow.
