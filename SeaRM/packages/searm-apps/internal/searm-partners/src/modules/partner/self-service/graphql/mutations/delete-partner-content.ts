import { type CoreApiClient } from 'searm-client-sdk/core';

export function deletePartnerContent(client: CoreApiClient, id: string) {
  return client.mutation({
    deletePartnerContent: { __args: { id }, id: true },
  });
}
