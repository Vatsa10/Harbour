import { Field, InputType } from '@nestjs/graphql';

import { IsOptional, IsString, IsUUID } from 'class-validator';

// Input for the unauthenticated getAuthorizationUrlForSSO mutation.
//
// Deliberately carries no workspaceId: the resolver derives the workspace from
// the request origin instead. Accepting it from the client would let an
// unauthenticated caller pair an arbitrary workspaceId with an arbitrary
// identityProviderId and probe which combinations exist.
@InputType()
export class GetAuthorizationUrlForSSOInput {
  @Field(() => String)
  @IsUUID()
  identityProviderId: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  returnToPath?: string;
}
