import { defineApplication } from 'searm-sdk/define';

import {
  APPLICATION_UNIVERSAL_IDENTIFIER,
  FIREFLIES_API_KEY_VARIABLE_UNIVERSAL_IDENTIFIER,
  FIREFLIES_WEBHOOK_SECRET_VARIABLE_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: 'Fireflies',
  description:
    'Sync Fireflies call transcripts and AI summaries into CallRecording records linked to matching CalendarEvents in SeaRM, and trigger sync / list / search of Fireflies calls from workflows and the AI chat.',
  logoUrl: 'public/searm-fireflies.svg',
  author: 'SeaRM',
  category: 'Productivity',
  screenshots: [
    'public/gallery/workflow-builder-actions.png',
    'public/gallery/app-settings.png',
  ],
  websiteUrl: 'https://docs.searm.com/developers/extend/apps/getting-started',
  termsUrl: 'https://www.searm.com/terms',
  emailSupport: 'contact@searm.com',
  issueReportUrl: 'https://github.com/Vatsa10/Harbour/issues',
  applicationVariables: {
    FIREFLIES_API_KEY: {
      universalIdentifier: FIREFLIES_API_KEY_VARIABLE_UNIVERSAL_IDENTIFIER,
      description:
        'API key from Fireflies (Integrations → Fireflies API → Generate). Used as a Bearer token against https://api.fireflies.ai/graphql to fetch full transcript content after a webhook fires.',
      isSecret: true,
    },
    FIREFLIES_WEBHOOK_SECRET: {
      universalIdentifier:
        FIREFLIES_WEBHOOK_SECRET_VARIABLE_UNIVERSAL_IDENTIFIER,
      description:
        'Signing secret for verifying Fireflies Webhooks V2 payloads (sent in the X-Hub-Signature header as sha256=<hex-hmac-sha256-of-body>). Configure the same value on the Fireflies V2 webhook setup page.',
      isSecret: true,
    },
  },
});
