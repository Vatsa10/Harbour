import { Field, InputType } from '@nestjs/graphql';

import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

import { type WorkflowTemplateKey } from 'src/modules/workflow/workflow-templates/types/workflow-template.type';

const TEMPLATE_KEYS: WorkflowTemplateKey[] = [
  'RESEARCH_BRIEF',
  'FOLLOW_UP_DIGEST',
  'ACCOUNT_MONITORING',
];

@InputType()
export class InstallWorkflowTemplateInput {
  @Field(() => String)
  @IsString()
  @IsIn(TEMPLATE_KEYS)
  key: WorkflowTemplateKey;

  @Field(() => Boolean, { nullable: true })
  @IsBoolean()
  @IsOptional()
  activate?: boolean;
}
