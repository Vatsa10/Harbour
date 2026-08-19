import { ArgsType, Field } from '@nestjs/graphql';

import { IsEnum, IsOptional, IsString, IsUUID, IsUrl } from 'class-validator';

import { IsX509Certificate } from 'src/engine/core-modules/sso/dtos/validators/x509.validator';
import { IdentityProviderType } from 'src/engine/core-modules/sso/workspace-sso-identity-provider.entity';

@ArgsType()
export class SetupSsoInput {
  @Field(() => String)
  @IsUUID()
  workspaceId: string;

  @Field(() => String)
  @IsString()
  name: string;

  @Field(() => IdentityProviderType)
  @IsEnum(IdentityProviderType)
  type: IdentityProviderType;

  @Field(() => String)
  @IsString()
  issuer: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUrl({ require_tld: false })
  ssoUrl?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsX509Certificate()
  certificate?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  clientID?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  clientSecret?: string;
}

export class SetupOIDCSsoInput extends SetupSsoInput {}
export class SetupSAMLSsoInput extends SetupSsoInput {}
