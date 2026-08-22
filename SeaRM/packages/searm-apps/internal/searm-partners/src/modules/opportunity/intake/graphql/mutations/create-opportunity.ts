import type { CoreApiClient, CoreSchema } from 'searm-client-sdk/core';

export function createOpportunity(
  client: CoreApiClient,
  data: CoreSchema.OpportunityCreateInput,
) {
  return client.mutation({
    createOpportunity: { __args: { data }, id: true },
  });
}
