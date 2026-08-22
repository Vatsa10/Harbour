import { type AgentResponseSchema } from 'searm-shared/ai';
import { type BaseOutputSchemaV2 } from 'searm-shared/workflow';

export const agentResponseSchemaToOutputSchema = (
  schema: AgentResponseSchema | undefined,
): BaseOutputSchemaV2 => {
  if (!schema?.properties || Object.keys(schema.properties).length === 0) {
    return {
      response: {
        isLeaf: true,
        type: 'string',
        label: 'Response',
        value: null,
      },
    };
  }

  const outputSchema: BaseOutputSchemaV2 = {};

  for (const [fieldName, field] of Object.entries(schema.properties)) {
    outputSchema[fieldName] = {
      isLeaf: true,
      type: field.type,
      label: fieldName,
      value: null,
    };
  }

  return outputSchema;
};
