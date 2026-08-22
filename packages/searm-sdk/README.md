<div align="center">
  <a href="https://searm.com">
    <picture>
      <img alt="SeaRM logo" src="https://raw.githubusercontent.com/Vatsa10/Harbour/main/packages/searm-website/public/images/core/logo.svg" height="128">
    </picture>
  </a>
  <h1>SeaRM SDK</h1>

<a href="https://www.npmjs.com/package/searm-sdk"><img alt="NPM version" src="https://img.shields.io/npm/v/searm-sdk.svg?style=for-the-badge&labelColor=000000"></a>
<a href="https://github.com/Vatsa10/Harbour/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/npm/l/next.svg?style=for-the-badge&labelColor=000000"></a>
<a href="https://discord.gg/cx5n4Jzs57"><img alt="Join the community on Discord" src="https://img.shields.io/badge/Join%20the%20community-blueviolet.svg?style=for-the-badge&logo=SeaRM&labelColor=000000&logoWidth=20"></a>

</div>

A CLI and SDK to develop, build, and publish applications that extend [SeaRM CRM](https://searm.com).

## Quick start

The recommended way to start is with [create-searm-app](https://www.npmjs.com/package/create-searm-app):

```bash
npx create-searm-app@latest my-searm-app
cd my-searm-app
yarn searm dev
```

## Documentation

Full documentation is available at **[docs.searm.com/developers/extend/apps](https://docs.searm.com/developers/extend/apps/getting-started)**:

- [Getting Started](https://docs.searm.com/developers/extend/apps/getting-started) — scaffolding, local server, authentication, dev mode
- [Building Apps](https://docs.searm.com/developers/extend/apps/building) — entity definitions, API clients, testing, CLI reference
- [Publishing](https://docs.searm.com/developers/extend/apps/publishing) — deploy, npm publish, marketplace

Guides in this repository:

- [Logic function inputs](./docs/logic-function-inputs.md) — input schema inference, record-typed inputs, and the id contract

## Manual installation

If you are adding `searm-sdk` to an existing project instead of using `create-searm-app`:

```bash
yarn add searm-sdk searm-client-sdk
```

Then add a `searm` script to your `package.json`:

```json
{
  "scripts": {
    "searm": "searm"
  }
}
```

Run `yarn searm help` to see all available commands.

## Configuration

The CLI stores credentials per remote in `~/.searm/config.json`. Run `yarn searm remote:add` to configure a remote, or `yarn searm remote:list` to see existing ones.

## Troubleshooting

- Auth errors: run `yarn searm remote:add` to re-authenticate.
- Typings out of date: restart `yarn searm dev` to refresh the client and types.
- Not seeing changes in dev: make sure dev mode is running (`yarn searm dev`).

## Contributing

### Development setup

```bash
git clone https://github.com/Vatsa10/Harbour.git
cd searm
yarn install
```

### Development mode

```bash
npx nx run searm-sdk:dev
```

### Production build

```bash
npx nx run searm-sdk:build
```

### Running the CLI locally

```bash
npx nx run searm-sdk:start -- <command>
```

### Resources

- See our [GitHub](https://github.com/Vatsa10/Harbour)
- Join our [Discord](https://discord.gg/cx5n4Jzs57)
