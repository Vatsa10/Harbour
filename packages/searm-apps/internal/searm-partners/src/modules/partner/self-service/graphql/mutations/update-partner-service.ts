import { type CoreApiClient, type CoreSchema } from 'searm-client-sdk/core';

export function updatePartnerService(
  client: CoreApiClient,
  id: string,
  data: CoreSchema.PartnerServiceUpdateInput,
) {
  return client.mutation({
    updatePartnerService: { __args: { id, data }, id: true },
  });
}
