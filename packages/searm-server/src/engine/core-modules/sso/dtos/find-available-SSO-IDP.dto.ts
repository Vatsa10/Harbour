import { Field, ObjectType } from '@nestjs/graphql';

import {
  IdentityProviderType,
  SSOIdentityProviderStatus,
} from 'src/engine/core-modules/sso/workspace-sso-identity-provider.entity';

type AvailableSSOIdentityProviderSource = {
  id: string;
  name: string;
  type: IdentityProviderType;
  status: SSOIdentityProviderStatus;
  issuer: string;
};

@ObjectType('AvailableSSOIdentityProvider')
export class AvailableSSOIdentityProviderDTO {
  @Field(() => String)
  id: string;

  @Field(() => String)
  name: string;

  @Field(() => IdentityProviderType)
  type: IdentityProviderType;

  @Field(() => SSOIdentityProviderStatus)
  status: SSOIdentityProviderStatus;

  @Field(() => String)
  issuer: string;

  static fromConfiguration(
    source: AvailableSSOIdentityProviderSource,
  ): AvailableSSOIdentityProviderDTO {
    return {
      id: source.id,
      name: source.name,
      type: source.type,
      status: source.status,
      issuer: source.issuer,
    };
  }
}

@ObjectType('FindAvailableSSOIDP')
export class FindAvailableSSOIDPDTO {
  @Field(() => [AvailableSSOIdentityProviderDTO])
  identityProviders: AvailableSSOIdentityProviderDTO[];
}
