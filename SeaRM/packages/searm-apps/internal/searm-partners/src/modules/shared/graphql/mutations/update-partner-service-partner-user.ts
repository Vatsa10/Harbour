import { type CoreApiClient } from 'searm-client-sdk/core';

export function updatePartnerServicePartnerUser(client: CoreApiClient, id: string, partnerUserId: string) {
  return client.mutation({ updatePartnerService: { __args: { id, data: { partnerUserId } }, id: true } });
}
