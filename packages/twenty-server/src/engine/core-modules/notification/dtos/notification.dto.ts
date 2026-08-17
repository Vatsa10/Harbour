import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType('Notification')
export class NotificationDTO {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  title: string;

  @Field(() => String, { nullable: true })
  body: string | null;

  @Field(() => String, { nullable: true })
  linkPath: string | null;

  @Field(() => Date, { nullable: true })
  readAt: Date | null;

  @Field(() => Date)
  createdAt: Date;
}
