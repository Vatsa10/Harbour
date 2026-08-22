import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';

import { DeleteSsoDTO } from 'src/engine/core-modules/sso/dtos/delete-sso.dto';
import { DeleteSsoInput } from 'src/engine/core-modules/sso/dtos/delete-sso.input';
import { EditSsoDTO } from 'src/engine/core-modules/sso/dtos/edit-sso.dto';
import { EditSsoInput } from 'src/engine/core-modules/sso/dtos/edit-sso.input';
import {
  AvailableSSOIdentityProviderDTO,
  FindAvailableSSOIDPDTO,
} from 'src/engine/core-modules/sso/dtos/find-available-SSO-IDP.dto';
import { SetupSsoDTO } from 'src/engine/core-modules/sso/dtos/setup-sso.dto';
import { SetupSsoInput } from 'src/engine/core-modules/sso/dtos/setup-sso.input';
import { SSOService } from 'src/engine/core-modules/sso/services/sso.service';

@Resolver()
export class SSOResolver {
  constructor(private readonly ssoService: SSOService) {}

  @Query(() => FindAvailableSSOIDPDTO)
  async findAvailableSSOIdentityProviders(
    @Args('workspaceId') workspaceId: string,
  ): Promise<FindAvailableSSOIDPDTO> {
    const identityProviders =
      await this.ssoService.findAvailableSSOIdentityProviders(workspaceId);

    return {
      identityProviders: identityProviders.map((identityProvider) =>
        AvailableSSOIdentityProviderDTO.fromConfiguration({
          id: identityProvider.id,
          type: identityProvider.type,
          name: identityProvider.name,
          status: identityProvider.status,
          issuer: identityProvider.issuer,
        }),
      ),
    };
  }

  @Mutation(() => SetupSsoDTO)
  async setupSso(@Args() input: SetupSsoInput): Promise<SetupSsoDTO> {
    const identityProvider = await this.ssoService.createSSOIdentityProvider(
      input,
    );

    return {
      id: identityProvider.id,
      name: identityProvider.name,
      type: identityProvider.type,
      status: identityProvider.status,
      issuer: identityProvider.issuer,
    };
  }

  @Mutation(() => EditSsoDTO)
  async editSso(@Args() input: EditSsoInput): Promise<EditSsoDTO> {
    const identityProvider = await this.ssoService.editSSOIdentityProvider(
      input,
    );

    return {
      id: identityProvider.id,
      name: identityProvider.name,
      type: identityProvider.type,
      status: identityProvider.status,
      issuer: identityProvider.issuer,
    };
  }

  @Mutation(() => DeleteSsoDTO)
  async deleteSso(@Args() input: DeleteSsoInput): Promise<DeleteSsoDTO> {
    const { identityProviderId } =
      await this.ssoService.deleteSSOIdentityProvider(
        input.identityProviderId,
        input.workspaceId,
      );

    return { success: true, identityProviderId };
  }
}
