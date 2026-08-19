import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType('GetAuthorizationUrlForSSO')
export class GetAuthorizationUrlForSSODTO {
  @Field(() => String)
  id: string;

  @Field(() => String)
  authorizationURL: string;

  @Field(() => String)
  type: string;
}
