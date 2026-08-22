This is a [SeaRM](https://searm.com) application project bootstrapped with [`create-searm-app`](https://www.npmjs.com/package/create-searm-app).

## Getting Started

First, authenticate to your workspace:

```bash
yarn searm remote:add --api-url http://localhost:2020 --as local
```

Then, start development mode to sync your app and watch for changes:

```bash
yarn searm dev
```

Open your SeaRM instance and go to `/settings/applications` section to see the result.

## Available Commands

Run `yarn searm help` to list all available commands. Common commands:

```bash
# Remotes & Authentication
yarn searm remote:add --api-url http://localhost:2020 --as local     # Authenticate with SeaRM
yarn searm remote:status         # Check auth status
yarn searm remote:use            # Set default remote
yarn searm remote:list           # List all configured remotes
yarn searm remote:remove <name>  # Remove a remote

# Application
yarn searm dev            # Start dev mode (watch, build, sync, and auto-generate typed client)
yarn searm dev:add        # Scaffold a new entity (object, field, function, front-component, role, view, navigation-menu-item)
yarn searm dev:function:logs    # Stream function logs
yarn searm dev:function:exec    # Execute a function with JSON payload
yarn searm app:uninstall  # Uninstall app from workspace
```

## Integration Tests

If your project includes the example integration test (`src/__tests__/app-install.integration-test.ts`), you can run it with:

```bash
# Make sure a SeaRM server is running at http://localhost:3000
yarn test
```

The test builds and installs the app, then verifies it appears in the applications list. Test configuration (API URL and API key) is defined in `vitest.config.ts`.

## LLMs instructions

Main docs and pitfalls are available in LLMS.md file.

## Learn More

To learn more about SeaRM applications, take a look at the following resources:

- [searm-sdk](https://www.npmjs.com/package/searm-sdk) - learn about `searm-sdk` tool.
- [SeaRM doc](https://docs.searm.com/) - SeaRM's documentation.
- Join our [Discord](https://discord.gg/cx5n4Jzs57)

You can check out [the SeaRM GitHub repository](https://github.com/Vatsa10/Harbour) - your feedback and contributions are welcome!
