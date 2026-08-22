# CLI And Sync

Use this reference for SeaRM app CLI command behavior, remotes, authentication, sync, validation commands, build, deploy, logs, function execution, and CI/CD troubleshooting.

Use `../develop-app/app-structure.md` only for app file layout and post-entity-edit validation checklists.

## App Checks

Before running operational commands, confirm the current directory is a SeaRM app and inspect the active scripts and remotes:

```bash
test -f package.json
test -f src/application-config.ts
sed -n '1,220p' package.json
yarn searm remote:list
```

Treat deploys, uninstalls, production remote changes, and production syncs as externally visible actions. Ask for explicit confirmation before running them when the target is production or user data could be affected.

## Validation Commands

Use these commands to validate an app after changes:

```bash
yarn searm dev:typecheck
yarn lint
yarn searm dev --once
```

`yarn searm dev:typecheck` checks generated app types and TypeScript compatibility. `yarn lint` checks local lint rules. `yarn searm dev --once` performs a bounded build/sync against the active remote.

If a validation command fails because of entity definitions, switch to `develop-app` for the fix. If it fails because of remotes, authentication, build tooling, sync, logs, deploys, or CI/CD, stay in `manage-app`.

## Remotes

A remote is a SeaRM server that the app can sync or deploy to. Credentials are stored locally in `~/.searm/config.json`.

Common commands:

```bash
# Add a remote interactively.
yarn searm remote:add

# Connect to a local SeaRM server.
yarn searm remote:add --local

# Add a remote non-interactively.
yarn searm remote:add --url https://your-searm-server.com --api-key $SEARM_API_KEY --as production

# List configured remotes.
yarn searm remote:list

# Switch the active remote.
yarn searm remote:use <name>
```

When the user says "prod", "production", or "workspace de prod", identify the target remote before syncing or deploying. If it is missing, add it with `--as production` or the user-provided name.

## Development Sync

Always use one-shot sync to synchronize app changes with the active remote:

```bash
yarn searm dev --once
```

Do not use bare `yarn searm dev` (watch mode). Run `yarn searm dev --once` each time changes need to be synced.

One-shot sync requires an authenticated remote. If authentication fails, re-add or switch the remote before retrying.

Use verbose one-shot sync for bounded troubleshooting:

```bash
yarn searm dev --once --verbose
```

## Troubleshooting

Start by identifying which layer is failing:

- Remote/authentication.
- Dev sync or one-shot sync.
- Build/package generation.
- Deploy/upload/install.
- Runtime function execution.
- CI/CD environment or secrets.

Collect the minimum useful context before changing configuration:

```bash
sed -n '1,220p' package.json
sed -n '1,220p' src/application-config.ts
yarn searm remote:list
yarn searm dev --once --verbose
```

For remote or authentication issues:

- Check that the active remote is the intended workspace or server.
- Re-run `yarn searm remote:add --local` for local app-dev servers.
- Re-run `yarn searm remote:add --url <url> --as <name>` for remote servers.
- Avoid overwriting a production remote until the target URL is confirmed.

For sync issues:

- Prefer `yarn searm dev --once --verbose` to get a bounded failure.
- Check generated type or schema errors before editing app entities.
- If the app depends on a changed data model, use `develop-app` to fix the entity definitions.

## Build, Deploy, Logs, And Exec

Build before deploy when the user asks for release readiness or when debugging packaging issues:

```bash
yarn searm dev:build
```

Publish an app to npm, or publish privately to a configured SeaRM server registry:

```bash
yarn searm app:publish
yarn searm app:publish --private --remote production
yarn searm app:install --remote production
```

Before deploying an update, check that `package.json` has a strictly higher semver `version` than the currently deployed version. Re-deploying the same version is rejected. After a private publish, install the deployed version with `yarn searm app:install` when the target workspace should use it.

Use function logs when debugging runtime behavior on the connected server:

```bash
yarn searm dev:function:logs
yarn searm dev:function:logs -n <function-name>
```

Run a logic function manually when testing behavior without its trigger:

```bash
yarn searm dev:function:exec -n <function-name>
yarn searm dev:function:exec -n <function-name> -p '{"key":"value"}'
```

Uninstall only after confirmation:

```bash
yarn searm app:uninstall
yarn searm app:uninstall --yes
```

Integration tests install and uninstall the app on their target server, so run them against the isolated test instance (`yarn searm docker:start --test`, port `2021`) rather than the dev instance — see `../develop-app/tests.md`.

## CI/CD

Apps generated with `create-searm-app` can use GitHub Actions for CI and CD. For deployment automation, check the app's `.github/workflows/` files and configure:

- `SEARM_DEPLOY_URL`
- `SEARM_DEPLOY_API_KEY`

Do not put API keys in source files. Use the repository or CI secret store.
