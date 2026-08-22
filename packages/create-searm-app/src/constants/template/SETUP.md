# Setup

Follow these steps to get your app running locally.

## Prerequisites

- Node.js (version specified in `.nvmrc`)
- Yarn 4
- Docker (to run the local SeaRM server)

## Steps

1. Install dependencies:

   ```bash
   yarn install
   ```

2. Start the local SeaRM server:

   ```bash
   yarn searm docker:start
   ```

   Check the server status at any time with `yarn searm docker:status`.

3. Start the development server and sync your app:

   ```bash
   yarn searm dev
   ```

4. Open [http://localhost:2020](http://localhost:2020) and log in with the default development credentials: `tim@apple.dev` / `tim@apple.dev`.

## Verifying your setup

- `yarn lint` - Lint the project with oxlint
- `yarn typecheck` - Type-check the project
- `yarn test:unit` - Run unit tests
- `yarn test` - Run integration tests

## Troubleshooting

See the [troubleshooting guide](https://docs.searm.com/developers/extend/apps/getting-started/troubleshooting) or ask on [Discord](https://discord.gg/cx5n4Jzs57).
