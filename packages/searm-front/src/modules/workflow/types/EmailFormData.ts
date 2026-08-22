import {
  type EmailRecipients,
  type WorkflowEmailFiles,
} from 'searm-shared/workflow';

export type EmailFormData = {
  connectedAccountId: string;
  recipients: Required<EmailRecipients>;
  subject: string;
  body: string;
  files: WorkflowEmailFiles;
  inReplyTo: string;
};
