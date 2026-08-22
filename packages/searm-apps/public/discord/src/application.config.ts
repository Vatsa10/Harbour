import { defineApplication } from 'searm-sdk/define';

import {
  APPLICATION_UNIVERSAL_IDENTIFIER,
  DISCORD_BOT_TOKEN_VARIABLE_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: 'SeaRM Discord',
  description:
    'Connect Discord to SeaRM. Workflow steps post, update, and delete bot messages and add reactions using a Discord bot token shared across the deployment.',
  logoUrl: 'public/searm-discord.svg',
  author: 'SeaRM',
  category: 'Communication',
  websiteUrl: 'https://docs.searm.com/developers/extend/apps/getting-started',
  termsUrl: 'https://www.searm.com/terms',
  emailSupport: 'contact@searm.com',
  issueReportUrl: 'https://github.com/Vatsa10/Harbour/issues',
  applicationVariables: {
    DISCORD_BOT_TOKEN: {
      universalIdentifier: DISCORD_BOT_TOKEN_VARIABLE_UNIVERSAL_IDENTIFIER,
      description:
        'Bot token from your Discord application (Developer Portal → Bot tab → Reset Token). Used with the `Bot` auth prefix to call the Discord REST API. The same token authenticates the bot across every guild it has been invited to.',
      isSecret: true,
    },
  },
});
