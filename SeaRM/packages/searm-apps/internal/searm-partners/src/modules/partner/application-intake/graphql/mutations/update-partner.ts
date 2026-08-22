import type { CoreApiClient, CoreSchema } from 'searm-client-sdk/core';

export function updatePartner(
  client: CoreApiClient,
  id: string,
  data: CoreSchema.PartnerUpdateInput,
) {
  return client.mutation({
    updatePartner: {
      __args: { id, data },
      id: true,
    },
  });
}
