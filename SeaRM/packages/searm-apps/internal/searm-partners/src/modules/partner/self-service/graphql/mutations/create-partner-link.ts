import { type CoreApiClient, type CoreSchema } from 'searm-client-sdk/core';

export function createPartnerLink(
  client: CoreApiClient,
  data: CoreSchema.PartnerLinkCreateInput,
) {
  return client.mutation({
    createPartnerLink: { __args: { data }, id: true },
  });
}
