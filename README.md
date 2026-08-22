<p align="center">
  <a href="https://github.com/Vatsa10/Harbour">
    <img src="./packages/searm-website/public/images/core/logo.svg" width="100px" alt="SeaRM logo" />
  </a>
</p>

<h2 align="center">SeaRM — an AI-native CRM, built on SeaRM</h2>

<p align="center"><a href="https://github.com/Vatsa10/Harbour"><img src="./packages/searm-website/public/images/readme/globe-icon.svg" width="12" height="12"/> Repository</a> · <a href="https://docs.searm.com"><img src="./packages/searm-website/public/images/readme/book-icon.svg" width="12" height="12"/> Upstream Documentation</a> · <a href="https://discord.gg/cx5n4Jzs57"><img src="./packages/searm-website/public/images/readme/discord-icon.svg" width="12" height="12"/> Discord</a></p>

<p align="center">
  <a href="https://github.com/Vatsa10/Harbour">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./packages/searm-website/public/images/readme/github-cover-dark.webp" />
      <source media="(prefers-color-scheme: light)" srcset="./packages/searm-website/public/images/readme/github-cover-light.webp" />
      <img src="./packages/searm-website/public/images/readme/github-cover-light.webp" alt="SeaRM banner" />
    </picture>
  </a>
</p>

<br />

# Why SeaRM

SeaRM gives technical teams the building blocks for a custom CRM that meets complex business needs and quickly adapts as the business evolves — with an AI-native trust layer on top: agents propose changes, humans approve them. SeaRM is a fork of [SeaRM](https://searm.com), the open-source CRM, extended for AI-assisted workflows.

<br />

# Installation

### <img src="./packages/searm-website/public/images/readme/rocket-icon.svg" width="14" height="14"/> Self-hosting

Run SeaRM on your own infrastructure with Docker Compose (`packages/searm-docker`), or contribute locally via the local setup guide in `docs/`.

### <img src="./packages/searm-website/public/images/readme/book-icon.svg" width="14" height="14"/> Build an app

Scaffold a new app with the CLI:

```bash
npx create-searm-app my-app
```

Define objects, fields, and views as code:

```ts
import { defineObject, FieldType } from 'searm-sdk/define';

export default defineObject({
  nameSingular: 'deal',
  namePlural: 'deals',
  labelSingular: 'Deal',
  labelPlural: 'Deals',
  fields: [
    { name: 'name', label: 'Name', type: FieldType.TEXT },
    { name: 'amount', label: 'Amount', type: FieldType.CURRENCY },
    { name: 'closeDate', label: 'Close Date', type: FieldType.DATE_TIME },
  ],
});
```

Then ship it to your workspace:

```bash
npx searm app:publish --private
```

> Note: the CLI binary and SDK package names above (`searm`, `searm-sdk`) are inherited from the upstream SeaRM toolchain and have not yet been renamed in this fork — see `docs/superpowers/rebrand-searm-workflow.js` for the rename plan. Product branding, docs, and UI have been rebranded to SeaRM.

See the upstream [app development guide](https://docs.searm.com/developers/extend/apps/getting-started) for objects, views, agents, and logic functions (applies to this fork's toolchain as well).

<br />
<br />

# Everything you need

SeaRM gives you the building blocks of a modern CRM (objects, views, workflows, and agents) and lets you extend them as code, plus an AI trust layer: every AI-proposed change to CRM data goes through an evidence-and-approval gate before it lands.

<table align="center">
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="./packages/searm-website/public/images/readme/v2-build-apps-dark.webp" />
        <source media="(prefers-color-scheme: light)" srcset="./packages/searm-website/public/images/readme/v2-build-apps-light.webp" />
        <img src="./packages/searm-website/public/images/readme/v2-build-apps-light.webp" alt="Create your apps" />
      </picture>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="./packages/searm-website/public/images/readme/v2-version-control-dark.webp" />
        <source media="(prefers-color-scheme: light)" srcset="./packages/searm-website/public/images/readme/v2-version-control-light.webp" />
        <img src="./packages/searm-website/public/images/readme/v2-version-control-light.webp" alt="Stay on top with version control" />
      </picture>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="./packages/searm-website/public/images/readme/v2-all-tools-dark.webp" />
        <source media="(prefers-color-scheme: light)" srcset="./packages/searm-website/public/images/readme/v2-all-tools-light.webp" />
        <img src="./packages/searm-website/public/images/readme/v2-all-tools-light.webp" alt="All the tools you need to build anything" />
      </picture>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="./packages/searm-website/public/images/readme/v2-tools-dark.webp" />
        <source media="(prefers-color-scheme: light)" srcset="./packages/searm-website/public/images/readme/v2-tools-light.webp" />
        <img src="./packages/searm-website/public/images/readme/v2-tools-light.webp" alt="Customize your layouts" />
      </picture>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="./packages/searm-website/public/images/readme/v2-ai-agents-dark.webp" />
        <source media="(prefers-color-scheme: light)" srcset="./packages/searm-website/public/images/readme/v2-ai-agents-light.webp" />
        <img src="./packages/searm-website/public/images/readme/v2-ai-agents-light.webp" alt="AI agents and chats" />
      </picture>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="./packages/searm-website/public/images/readme/v2-crm-tools-dark.webp" />
        <source media="(prefers-color-scheme: light)" srcset="./packages/searm-website/public/images/readme/v2-crm-tools-light.webp" />
        <img src="./packages/searm-website/public/images/readme/v2-crm-tools-light.webp" alt="Plus all the tools of a good CRM" />
      </picture>
    </td>
  </tr>
</table>

<br />

# Stack

- <a href="https://www.typescriptlang.org/"><img src="./packages/searm-website/public/images/readme/stack-typescript.svg" width="14" height="14"/> TypeScript</a>
- <a href="https://nx.dev/"><img src="./packages/searm-website/public/images/readme/stack-nx.svg" width="14" height="14"/> Nx</a>
- <a href="https://nestjs.com/"><img src="./packages/searm-website/public/images/readme/stack-nestjs.svg" width="14" height="14"/> NestJS</a>, with <a href="https://bullmq.io/">BullMQ</a>, <a href="https://www.postgresql.org/"><img src="./packages/searm-website/public/images/readme/stack-postgresql.svg" width="14" height="14"/> PostgreSQL</a>, <a href="https://redis.io/"><img src="./packages/searm-website/public/images/readme/stack-redis.svg" width="14" height="14"/> Redis</a>
- <a href="https://reactjs.org/"><img src="./packages/searm-website/public/images/readme/stack-react.svg" width="14" height="14"/> React</a>, with <a href="https://jotai.org/">Jotai</a>, <a href="https://linaria.dev/">Linaria</a> and <a href="https://lingui.dev/">Lingui</a>

# Attribution

SeaRM is a fork of [SeaRM](https://github.com/Vatsa10/Harbour), licensed under AGPL-3.0. All SeaRM copyright notices in this repository are preserved as required by the license; see [`LICENSE`](./LICENSE). SeaRM-specific work is layered on top of the original project.

# Thanks

<p align="center">
  <a href="https://greptile.com"><img src="./packages/searm-website/public/images/readme/greptile.webp" height="28" alt="Greptile" /></a>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://sentry.io/"><img src="./packages/searm-website/public/images/readme/sentry.webp" height="28" alt="Sentry" /></a>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://crowdin.com/"><img src="./packages/searm-website/public/images/readme/crowdin.webp" height="28" alt="Crowdin" /></a>
</p>

Thanks to these amazing services that we use and recommend for code review (Greptile), catching bugs (Sentry) and translating (Crowdin) — and to the SeaRM team and community for the upstream project this fork builds on.

# Repository

<p><a href="https://github.com/Vatsa10/Harbour"><img src="./packages/searm-website/public/images/readme/star-icon.svg" width="12" height="12"/> Star the repo</a> · <a href="https://github.com/Vatsa10/Harbour/discussions"><img src="./packages/searm-website/public/images/readme/message-icon.svg" width="12" height="12"/> Discussions</a> · <a href="https://github.com/Vatsa10/Harbour"><img src="./packages/searm-website/public/images/readme/code-icon.svg" width="12" height="12"/> Upstream SeaRM project</a></p>
