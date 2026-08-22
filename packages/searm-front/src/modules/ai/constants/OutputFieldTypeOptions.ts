import { type AgentResponseFieldType } from 'searm-shared/ai';
import { msg } from '@lingui/core/macro';
import {
  IllustrationIconNumbers,
  IllustrationIconText,
  IllustrationIconToggle,
} from 'searm-ui/icon';

export interface OutputSchemaField {
  id: string;
  name: string;
  description?: string;
  type: AgentResponseFieldType | undefined;
}

export const OUTPUT_FIELD_TYPE_OPTIONS = [
  {
    label: msg`Text`,
    value: 'string' as const,
    Icon: IllustrationIconText,
  },
  {
    label: msg`Number`,
    value: 'number' as const,
    Icon: IllustrationIconNumbers,
  },
  {
    label: msg`Boolean`,
    value: 'boolean' as const,
    Icon: IllustrationIconToggle,
  },
];
