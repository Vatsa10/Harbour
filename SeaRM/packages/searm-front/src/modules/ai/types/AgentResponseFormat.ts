import { type BaseOutputSchemaV2 } from 'searm-shared/workflow';

export type AgentResponseFormat =
  | { type: 'text' }
  | {
      type: 'json';
      schema: BaseOutputSchemaV2;
    };
