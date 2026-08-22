import { type CoreApiClient } from 'searm-client-sdk/core';

export function deletePartnerService(client: CoreApiClient, id: string) {
  return client.mutation({
    deletePartnerService: { __args: { id }, id: true },
  });
}
