import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { msg } from '@lingui/core/macro';
import { isDefined } from 'twenty-shared/utils';
import { Repository } from 'typeorm';

import { PublicDomainEntity } from 'src/engine/core-modules/public-domain/public-domain.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import {
  WorkspaceException,
  WorkspaceExceptionCode,
} from 'src/engine/core-modules/workspace/workspace.exception';

@Injectable()
export class CustomDomainManagerService {
  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    // Enforces global uniqueness of a custom domain across all workspaces.
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(PublicDomainEntity)
    private readonly publicDomainRepository: Repository<PublicDomainEntity>,
  ) {}

  // AGPL build: no paid tiers, every workspace is entitled to custom domains.
  async isCustomDomainEnabled(_workspaceId: string) {
    return;
  }

  async setCustomDomain(workspace: WorkspaceEntity, customDomain: string) {
    await this.isCustomDomainEnabled(workspace.id);

    // Custom domains are not supported in self-hosted deployments (requires Cloudflare)
    throw new WorkspaceException(
      'Custom domains are not supported in self-hosted deployments',
      WorkspaceExceptionCode.WORKSPACE_CUSTOM_DOMAIN_DISABLED,
      {
        userFriendlyMessage: msg`Custom domains are not available in this deployment`,
      },
    );
  }

  async checkCustomDomainValidRecords(workspace: WorkspaceEntity) {
    // Custom domains are not supported in self-hosted deployments (requires Cloudflare)
    throw new WorkspaceException(
      'Custom domains are not supported in self-hosted deployments',
      WorkspaceExceptionCode.WORKSPACE_CUSTOM_DOMAIN_DISABLED,
      {
        userFriendlyMessage: msg`Custom domains are not available in this deployment`,
      },
    );
  }
}
