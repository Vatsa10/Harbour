import { Field, ObjectType } from '@nestjs/graphql';

import { type SSOConfiguration } from 'src/engine/core-modules/sso/types/SSOConfigurations.type';
import {
  IdentityProviderType,
  SSOIdentityProviderStatus,
} from 'src/engine/core-modules/sso/workspace-sso-identity-provider.entity';

@ObjectType('SetupSSO')
export class SetupSsoDTO {
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

  static fromConfiguration(configuration: SSOConfiguration): SetupSsoDTO {
    return {
      id: configuration.id,
      name: configuration.name,
      type: configuration.type,
      status: configuration.status,
      issuer: configuration.issuer,
    };
  }
}
