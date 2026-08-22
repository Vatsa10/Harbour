import { defineSkill } from 'searm-sdk/define';

import { SUPPORT_TRIAGE_SKILL_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export default defineSkill({
  universalIdentifier: SUPPORT_TRIAGE_SKILL_UNIVERSAL_IDENTIFIER,
  name: 'support-ticket-triage',
  label: 'Support ticket triage',
  description: 'How to read and prioritize a new support ticket.',
  icon: 'IconRobot',
  content: `Triage rubric for support tickets:
- URGENT: production down, data loss, security issue, or the customer says "urgent"/"blocking".
- HIGH: a paying customer cannot complete a core workflow, no workaround exists.
- MEDIUM: a feature is broken or confusing but a workaround exists.
- LOW: a question, a cosmetic issue, or a feature request.

Read the ticket subject and description, and any linked company or person
record, to judge severity. Write one paragraph into aiTriageSummary
explaining the reasoning and citing what you read. Propose a priority and a
status of TRIAGED. Never mark a ticket RESOLVED or CLOSED yourself — a human
closes tickets. Every field you write is reviewed by a human before it takes
effect; state your reasoning as if someone will read it before approving.`,
});
