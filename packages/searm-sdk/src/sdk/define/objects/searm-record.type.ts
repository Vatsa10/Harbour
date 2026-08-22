export type SearmRecord<TObjectUniversalIdentifier extends string = string> =
  string & { readonly __object?: TObjectUniversalIdentifier };
