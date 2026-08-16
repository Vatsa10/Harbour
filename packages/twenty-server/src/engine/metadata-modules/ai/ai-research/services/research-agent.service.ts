import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { Repository } from 'typeorm';

import { AgentEntity } from 'src/engine/metadata-modules/ai/ai-agent/entities/agent.entity';
import { AiAgentRoleService } from 'src/engine/metadata-modules/ai/ai-agent-role/ai-agent-role.service';
import {
  RESEARCH_AGENT_ROLE_UNIVERSAL_IDENTIFIER,
  RESEARCH_AGENT_UNIVERSAL_IDENTIFIER,
} from 'src/engine/metadata-modules/ai/ai-research/constants/research-agent.const';
import { RoleTargetEntity } from 'src/engine/metadata-modules/role-target/role-target.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';

@Injectable()
export class ResearchAgentService {
  private readonly logger = new Logger(ResearchAgentService.name);

  constructor(
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(AgentEntity)
    private readonly agentRepository: Repository<AgentEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(RoleTargetEntity)
    private readonly roleTargetRepository: Repository<RoleTargetEntity>,
    private readonly aiAgentRoleService: AiAgentRoleService,
  ) {}

  // The workspace seed creates the agent row and the role row, but the
  // standard-application pipeline has no roleTarget mechanism (roleTarget is
  // not in TWENTY_STANDARD_ALL_METADATA_NAME), so the binding is made here on
  // first use. Idempotent: roleTarget is UNIQUE on (workspaceId, agentId).
  async resolveResearchAgentId(workspaceId: string): Promise<string> {
    const agent = await this.agentRepository.findOne({
      where: {
        workspaceId,
        universalIdentifier: RESEARCH_AGENT_UNIVERSAL_IDENTIFIER,
      },
    });

    if (!isDefined(agent)) {
      throw new Error(
        `This workspace's research agent is not seeded. Re-run the standard application sync for workspace ${workspaceId}.`,
      );
    }

    await this.ensureRoleBinding(workspaceId, agent.id);

    return agent.id;
  }

  // The GraphQL front door lets a caller name an agent. An id that is not in
  // this workspace, or that holds no role, produced a run with zero registry
  // tools that still reported SUCCEEDED — the same silent dead loop as an
  // unseeded workspace, one input field away. Rejecting it at the door is the
  // only place the caller can be told what is wrong.
  async assertAgentIsUsable(params: {
    workspaceId: string;
    agentId: string;
  }): Promise<void> {
    const agent = await this.agentRepository.findOne({
      where: { id: params.agentId, workspaceId: params.workspaceId },
    });

    if (!isDefined(agent)) {
      throw new Error(
        `No agent ${params.agentId} exists in this workspace. Omit agentId to use the workspace's research agent.`,
      );
    }

    const roleBinding = await this.roleTargetRepository.findOne({
      where: { workspaceId: params.workspaceId, agentId: params.agentId },
    });

    if (!isDefined(roleBinding)) {
      throw new Error(
        `Agent ${params.agentId} has no role, so it would run with no tools and find nothing. Omit agentId to use the workspace's research agent.`,
      );
    }
  }

  private async ensureRoleBinding(
    workspaceId: string,
    agentId: string,
  ): Promise<void> {
    // The binding is expensive (assignRoleToAgent runs a full flat-metadata
    // workspace migration), so it must happen once per workspace, never per
    // task dispatch. This existence check is what makes that true.
    const existingBinding = await this.roleTargetRepository.findOne({
      where: { workspaceId, agentId },
    });

    if (isDefined(existingBinding)) {
      return;
    }

    const role = await this.roleRepository.findOne({
      where: {
        workspaceId,
        universalIdentifier: RESEARCH_AGENT_ROLE_UNIVERSAL_IDENTIFIER,
      },
    });

    // An admin who deleted the seeded role gets a tool-less run, not a crash.
    // The worker turns that into a named outcome rather than "found nothing",
    // so the cause is visible in run history.
    if (!isDefined(role)) {
      this.logger.warn(
        `Research agent role missing in workspace ${workspaceId}; the research agent will run with no registry tools.`,
      );

      return;
    }

    await this.aiAgentRoleService.assignRoleToAgent({
      workspaceId,
      agentId,
      roleId: role.id,
    });
  }
}
