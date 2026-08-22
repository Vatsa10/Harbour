import type { CoreApiClient, CoreSchema } from 'searm-client-sdk/core';

export function updatePerson(
  client: CoreApiClient,
  id: string,
  data: CoreSchema.PersonUpdateInput,
) {
  return client.mutation({
    updatePerson: {
      __args: { id, data },
      id: true,
    },
  });
}
