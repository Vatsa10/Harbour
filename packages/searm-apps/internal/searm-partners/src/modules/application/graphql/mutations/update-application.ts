import { type CoreApiClient, type CoreSchema } from 'searm-client-sdk/core';

export function updateApplication(
  client: CoreApiClient,
  id: string,
  data: CoreSchema.ApplicationUpdateInput,
) {
  return client.mutation({
    updateApplication: { __args: { id, data }, id: true },
  });
}
