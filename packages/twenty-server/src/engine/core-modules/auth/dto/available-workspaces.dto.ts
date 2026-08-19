import { Field, ObjectType } from '@nestjs/graphql';

import { WorkspaceUrlsDTO } from 'src/engine/core-modules/workspace/dtos/workspace-urls.dto';

@ObjectType('AvailableSSOIdentityProvider')
export class AvailableSSOIdentityProviderDTO {
  @Field(() => String)
  id: string;

  @Field(() => String)
  name: string;

  @Field(() => String)
  issuer: string;

  @Field(() => String)
  type: string;

  @Field(() => String)
  status: string;
}

@ObjectType('AvailableWorkspace')
export class AvailableWorkspace {
  @Field(() => String)
  id: string;

  @Field(() => String, { nullable: true })
  displayName?: string;

  @Field(() => WorkspaceUrlsDTO)
  workspaceUrls: WorkspaceUrlsDTO;

  @Field(() => String)
  logo: string;

  @Field(() => [AvailableSSOIdentityProviderDTO])
  sso: AvailableSSOIdentityProviderDTO[];

  @Field(() => String, { nullable: true })
  personalInviteToken?: string;

  @Field(() => String, { nullable: true })
  loginToken?: string;
}

@ObjectType('AvailableWorkspaces')
export class AvailableWorkspaces {
  @Field(() => [AvailableWorkspace])
  availableWorkspacesForSignUp: AvailableWorkspace[];

  @Field(() => [AvailableWorkspace])
  availableWorkspacesForSignIn: AvailableWorkspace[];
}
