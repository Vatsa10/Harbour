import type { CoreApiClient, CoreSchema } from 'searm-client-sdk/core';

export function createPerson(
  client: CoreApiClient,
  data: CoreSchema.PersonCreateInput,
) {
  return client.mutation({
    createPerson: {
      __args: { data },
      id: true,
    },
  });
}
