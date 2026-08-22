export const STANDARD_AGENT = {
  helper: {
    universalIdentifier: '20202020-c7ab-4065-b822-0ca1d5de60a9',
  },
  // Literal repeated rather than imported from the ai-research feature module:
  // this is bootstrap code and must not depend on a feature module. The
  // research-agent.service spec asserts the two literals agree.
  researcher: {
    universalIdentifier: '20202020-9a3f-4c1e-8d27-6b41f0d5a7c3',
  },
} as const satisfies Record<
  string,
  {
    universalIdentifier: string;
  }
>;
