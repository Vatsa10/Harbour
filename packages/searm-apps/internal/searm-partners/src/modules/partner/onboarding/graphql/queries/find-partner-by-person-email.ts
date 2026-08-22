import { type CoreApiClient } from 'searm-client-sdk/core';

export function findPartnerByPersonEmail(client: CoreApiClient, email: string) {
  return client.query({
    people: {
      __args: { filter: { emails: { primaryEmail: { eq: email } } }, first: 1 },
      edges: {
        node: {
          id: true,
          partner: { id: true, validationStage: true },
        },
      },
    },
  });
}
