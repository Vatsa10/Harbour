import { type CoreApiClient } from 'searm-client-sdk/core';

export function updateCompanyPartnerUser(client: CoreApiClient, id: string, partnerUserId: string) {
  return client.mutation({ updateCompany: { __args: { id, data: { partnerUserId } }, id: true } });
}
