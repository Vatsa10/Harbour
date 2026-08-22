## Base documentation

- Getting started:
  - https://docs.searm.com/developers/extend/apps/getting-started/quick-start.md
  - https://docs.searm.com/developers/extend/apps/getting-started/concepts.md
  - https://docs.searm.com/developers/extend/apps/getting-started/project-structure.md
  - https://docs.searm.com/developers/extend/apps/getting-started/local-server.md
  - https://docs.searm.com/developers/extend/apps/getting-started/scaffolding.md
  - https://docs.searm.com/developers/extend/apps/getting-started/troubleshooting.md
- Config:
  - https://docs.searm.com/developers/extend/apps/config/overview.md
  - https://docs.searm.com/developers/extend/apps/config/application.md
  - https://docs.searm.com/developers/extend/apps/config/roles.md
  - https://docs.searm.com/developers/extend/apps/config/install-hooks.md
  - https://docs.searm.com/developers/extend/apps/config/public-assets.md
- Data:
  - https://docs.searm.com/developers/extend/apps/data/overview.md
  - https://docs.searm.com/developers/extend/apps/data/objects.md
  - https://docs.searm.com/developers/extend/apps/data/extending-objects.md
  - https://docs.searm.com/developers/extend/apps/data/relations.md
- Logic:
  - https://docs.searm.com/developers/extend/apps/logic/overview.md
  - https://docs.searm.com/developers/extend/apps/logic/logic-functions.md
  - https://docs.searm.com/developers/extend/apps/logic/skills-and-agents.md
  - https://docs.searm.com/developers/extend/apps/logic/connections.md
- Layout:
  - https://docs.searm.com/developers/extend/apps/layout/overview.md
  - https://docs.searm.com/developers/extend/apps/layout/views.md
  - https://docs.searm.com/developers/extend/apps/layout/navigation-menu-items.md
  - https://docs.searm.com/developers/extend/apps/layout/page-layouts.md
  - https://docs.searm.com/developers/extend/apps/layout/front-components.md
  - https://docs.searm.com/developers/extend/apps/layout/command-menu-items.md
- Operations:
  - https://docs.searm.com/developers/extend/apps/operations/overview.md
  - https://docs.searm.com/developers/extend/apps/operations/cli.md
  - https://docs.searm.com/developers/extend/apps/operations/testing.md
  - https://docs.searm.com/developers/extend/apps/operations/publishing.md
- Rich app example: https://github.com/Vatsa10/Harbour/tree/main/packages/searm-apps/examples/postcard

## UUID requirement

- All generated UUIDs must be valid UUID v4.

## Common Pitfalls

- Creating a view without a navigationMenuItem associated. This will make the view unavailable on the left sidebar.
- Creating a front-end component that has a scroll instead of being responsive to its fixed widget height and width, unless it is specifically meant to be used in a canvas tab.

## Best practice

It's highly recommended to create new app entities using `yarn searm dev:add`. These are the options:

| Entity type          | Command                                  | Generated file                        |
| -------------------- | ---------------------------------------- | ------------------------------------- |
| Object               | `yarn searm dev:add object`             | `src/objects/<name>.ts`               |
| Field                | `yarn searm dev:add field`              | `src/fields/<name>.ts`                |
| Logic function       | `yarn searm dev:add logicFunction`      | `src/logic-functions/<name>.ts`       |
| Front component      | `yarn searm dev:add frontComponent`     | `src/front-components/<name>.tsx`     |
| Role                 | `yarn searm dev:add role`               | `src/roles/<name>.ts`                 |
| Skill                | `yarn searm dev:add skill`              | `src/skills/<name>.ts`                |
| Agent                | `yarn searm dev:add agent`              | `src/agents/<name>.ts`                |
| View                 | `yarn searm dev:add view`               | `src/views/<name>.ts`                 |
| Navigation menu item | `yarn searm dev:add navigationMenuItem` | `src/navigation-menu-items/<name>.ts` |
| Page layout          | `yarn searm dev:add pageLayout`         | `src/page-layouts/<name>.ts`          |

This helps automatically generate required IDs etc.
