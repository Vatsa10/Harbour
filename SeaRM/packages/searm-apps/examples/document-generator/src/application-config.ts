import { defineApplication } from 'searm-sdk/define';

import {
  APP_DESCRIPTION,
  APP_DISPLAY_NAME,
  APPLICATION_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

// The default role is declared with defineApplicationRole() in
// src/roles/default-role.ts and picked up automatically.
export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: APP_DISPLAY_NAME,
  description: APP_DESCRIPTION,
  logo: 'public/document-generator.svg',
  galleryImages: [
    'public/gallery/01-template-editor.png',
    'public/gallery/02-command-menu.png',
    'public/gallery/03-documents.png',
    'public/gallery/04-generated-document.png',
  ],
  author: 'SeaRM',
  category: 'Productivity',
  websiteUrl:
    'https://docs.searm.com/developers/extend/apps/tutorials/document-generator/overview',
  termsUrl: 'https://www.searm.com/terms',
  emailSupport: 'contact@searm.com',
  issueReportUrl: 'https://github.com/Vatsa10/Harbour/issues',
});
