import { type CoreApiClient } from 'searm-client-sdk/core';

export function deleteApplication(client: CoreApiClient, id: string) {
  return client.mutation({
    deleteApplication: {
      __args: { id },
      id: true,
    },
  });
}
