import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType('DeleteSSO')
export class DeleteSsoDTO {
  @Field(() => Boolean)
  success: boolean;

  @Field(() => String)
  identityProviderId: string;
}
