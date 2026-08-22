import { type EmailRecipients } from 'searm-shared/workflow';

export type EmailDraftPrefill = EmailRecipients & {
  messageId: string;
  subject: string;
  body: string;
};
