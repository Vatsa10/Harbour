import { type CoreApiClient } from 'searm-client-sdk/core';

export function deletePartnerLink(client: CoreApiClient, id: string) {
  return client.mutation({
    deletePartnerLink: { __args: { id }, id: true },
  });
}
