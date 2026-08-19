import { ArgsType, Field } from '@nestjs/graphql';

import { IsUUID } from 'class-validator';

@ArgsType()
export class DeleteSsoInput {
  @Field(() => String)
  @IsUUID()
  identityProviderId: string;

  @Field(() => String)
  @IsUUID()
  workspaceId: string;
}
