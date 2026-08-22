import { t } from '@lingui/core/macro';

export const getStandardApplicationDescription =
  (): string => t`The base data model every SeaRM workspace runs on.

#### What "foundation" means

Every SeaRM workspace starts with this set of objects. They define the shape of your CRM, including relationships, activity, and reporting. Everything else, including marketplace apps, AI agents, and custom objects, plugs into them.

#### Included objects
- **People & Companies**: contact and account records
- **Opportunities**: your sales pipeline
- **Notes & Tasks**: activity and follow-ups
- **Workflows & Dashboards**: automation and reporting

Remove this app and the rest of SeaRM has nothing to hang off.

#### Build your own app

Extend SeaRM with your own objects, fields, logic functions, or AI skills. Scaffold a new app in one command:

\`\`\`bash
npx create-searm-app@latest my-searm-app
\`\`\`

Then inside the folder:

\`\`\`bash
cd my-searm-app
yarn searm dev
\`\`\`

See the [Getting Started guide](https://searm.com/developers/extend/apps/getting-started) for the full walkthrough, and [Building Apps](https://searm.com/developers/extend/apps/building) for the \`defineApplication\` / \`defineEntity\` APIs.`;
