import { type CoreApiClient } from 'searm-client-sdk/core';

export function getPartnerOwner(client: CoreApiClient, partnerId: string) {
  return client.query({
    partner: { __args: { filter: { id: { eq: partnerId } } }, id: true, partnerUserId: true },
  });
}
