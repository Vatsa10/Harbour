import type { CoreApiClient, CoreSchema } from 'searm-client-sdk/core';

export function createPartner(
  client: CoreApiClient,
  data: CoreSchema.PartnerCreateInput,
) {
  return client.mutation({
    createPartner: {
      __args: { data },
      id: true,
    },
  });
}
