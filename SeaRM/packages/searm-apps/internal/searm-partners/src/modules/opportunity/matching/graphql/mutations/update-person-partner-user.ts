import type { CoreApiClient } from 'searm-client-sdk/core';

export function updatePersonPartnerUser(
  client: CoreApiClient,
  id: string,
  partnerUserId: string | null,
) {
  return client.mutation({
    updatePerson: { __args: { id, data: { partnerUserId } }, id: true },
  });
}
