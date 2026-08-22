import { type EmailAttachment } from 'searm-shared/types';
import { type EmailRecipients } from 'searm-shared/workflow';

export type WorkflowSendEmailActionInput = {
  connectedAccountId: string;
  recipients: EmailRecipients;
  subject?: string;
  body?: string;
  files?: EmailAttachment[];
  inReplyTo?: string;
};
