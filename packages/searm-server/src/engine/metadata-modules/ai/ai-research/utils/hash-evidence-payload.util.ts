import { createHash } from 'crypto';

import { type EvidencePayload } from 'src/engine/metadata-modules/ai/ai-research/types/evidence.type';

export const hashEvidencePayload = (payload: EvidencePayload): string =>
  createHash('sha256').update(JSON.stringify(payload)).digest('hex');
