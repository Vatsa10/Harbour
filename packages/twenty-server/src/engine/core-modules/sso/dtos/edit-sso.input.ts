import { ArgsType, Field } from '@nestjs/graphql';

import { IsOptional, IsString, IsUUID, IsUrl } from 'class-validator';

import { IsX509Certificate } from 'src/engine/core-modules/sso/dtos/validators/x509.validator';
import { SSOIdentityProviderStatus } from 'src/engine/core-modules/sso/workspace-sso-identity-provider.entity';

@ArgsType()
export class EditSsoInput {
  @Field(() => String)
  @IsUUID()
  identityProviderId: string;

  @Field(() => String)
  @IsUUID()
  workspaceId: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  name?: string;

  @Field(() => SSOIdentityProviderStatus, { nullable: true })
  @IsOptional()
  status?: SSOIdentityProviderStatus;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  issuer?: string;

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
