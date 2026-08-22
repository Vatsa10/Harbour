import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType('WorkflowTemplate')
export class WorkflowTemplateDTO {
  @Field(() => String)
  key: string;

  @Field(() => String)
  name: string;

  @Field(() => String)
  description: string;
}

@ObjectType('InstalledWorkflowTemplate')
export class InstalledWorkflowTemplateDTO {
  @Field(() => ID)
  workflowId: string;

  @Field(() => ID)
  workflowVersionId: string;
}
