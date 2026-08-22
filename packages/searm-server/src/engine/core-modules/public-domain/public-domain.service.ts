import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { msg } from '@lingui/core/macro';
import { isDefined } from 'searm-shared/utils';
import { Repository } from 'typeorm';

import { ApplicationEntity } from 'src/engine/core-modules/application/application.entity';
import { PublicDomainDTO } from 'src/engine/core-modules/public-domain/dtos/public-domain.dto';
import { PublicDomainEntity } from 'src/engine/core-modules/public-domain/public-domain.entity';
import {
  PublicDomainException,
  PublicDomainExceptionCode,
} from 'src/engine/core-modules/public-domain/public-domain.exception';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { InjectWorkspaceScopedRepository } from 'src/engine/searm-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { WorkspaceScopedRepository } from 'src/engine/searm-orm/workspace-scoped-repository/workspace-scoped-repository';

@Injectable()
export class PublicDomainService {
  constructor(
    @InjectWorkspaceScopedRepository(PublicDomainEntity)
    private readonly publicDomainRepository: WorkspaceScopedRepository<PublicDomainEntity>,
    // Hostname-to-workspace resolution at request-routing time, before workspace context exists.
    // eslint-disable-next-line searm/prefer-workspace-scoped-repository
    @InjectRepository(PublicDomainEntity)
    private readonly publicDomainRepositoryUnscoped: Repository<PublicDomainEntity>,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    @InjectRepository(ApplicationEntity)
    private readonly applicationRepository: Repository<ApplicationEntity>,
  ) {}

  async deletePublicDomain({
    domain,
    workspace,
  }: {
    domain: string;
    workspace: WorkspaceEntity;
  }): Promise<void> {
    const formattedDomain = domain.trim().toLowerCase();

    // Public domains are not supported in self-hosted deployments (requires Cloudflare)
    throw new PublicDomainException(
      'Public domains are not supported in self-hosted deployments',
      PublicDomainExceptionCode.PUBLIC_DOMAIN_ALREADY_REGISTERED,
      {
        userFriendlyMessage: msg`Public domains are not available in this deployment`,
      },
    );
  }

  async createPublicDomain({
    domain,
    workspace,
    applicationId,
  }: {
    domain: string;
    workspace: WorkspaceEntity;
    applicationId: string;
  }): Promise<PublicDomainDTO> {
    // Public domains are not supported in self-hosted deployments (requires Cloudflare)
    throw new PublicDomainException(
      'Public domains are not supported in self-hosted deployments',
      PublicDomainExceptionCode.PUBLIC_DOMAIN_ALREADY_REGISTERED,
      {
        userFriendlyMessage: msg`Public domains are not available in this deployment`,
      },
    );
  }

  async findByDomain(domain: string) {
    return this.publicDomainRepositoryUnscoped.findOne({ where: { domain } });
  }
}
