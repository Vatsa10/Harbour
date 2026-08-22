export const STANDARD_ROLE = {
  admin: { universalIdentifier: '20202020-02c2-43f2-b94d-cab1f2b532eb' },
  aiResearcher: {
    universalIdentifier: '20202020-4e88-4b0a-9f16-2c7d3ae91b54',
  },
} as const satisfies Record<string, { universalIdentifier: string }>;
