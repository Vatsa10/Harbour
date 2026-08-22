import type { CoreApiClient } from 'searm-client-sdk/core';

export function findPersonByEmail(client: CoreApiClient, primaryEmail: string) {
  return client.query({
    people: {
      __args: { filter: { emails: { primaryEmail: { eq: primaryEmail } } }, first: 1 },
      edges: { node: { id: true } },
    },
  });
}
