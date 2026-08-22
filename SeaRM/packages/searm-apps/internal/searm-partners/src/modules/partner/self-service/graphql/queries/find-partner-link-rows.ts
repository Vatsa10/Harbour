import { type CoreApiClient } from 'searm-client-sdk/core';

export function findPartnerLinkRows(client: CoreApiClient, partnerId: string) {
  return client.query({
    partnerLinks: {
      __args: { filter: { partnerId: { eq: partnerId } } },
      edges: {
        node: {
          id: true,
          name: true,
          url: { primaryLinkUrl: true },
          sortOrder: true,
        },
      },
    },
  });
}
