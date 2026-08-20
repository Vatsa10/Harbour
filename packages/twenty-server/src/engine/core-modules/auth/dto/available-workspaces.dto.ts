// AvailableSSOIdentityProvider is declared once, by the module that owns SSO
// types. Re-exported here so auth consumers keep their import path.
import { AvailableSSOIdentityProviderDTO } from 'src/engine/core-modules/sso/dtos/find-available-SSO-IDP.dto';
import { Field, ObjectType } from '@nestjs/graphql';

import { WorkspaceUrlsDTO } from 'src/engine/core-modules/workspace/dtos/workspace-urls.dto';

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

export { AvailableSSOIdentityProviderDTO };
