import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AgentEntity } from 'src/engine/metadata-modules/ai/ai-agent/entities/agent.entity';
import { AiAgentRoleService } from 'src/engine/metadata-modules/ai/ai-agent-role/ai-agent-role.service';
import {
  RESEARCH_AGENT_ROLE_UNIVERSAL_IDENTIFIER,
  RESEARCH_AGENT_UNIVERSAL_IDENTIFIER,
} from 'src/engine/metadata-modules/ai/ai-research/constants/research-agent.const';
import { ResearchAgentService } from 'src/engine/metadata-modules/ai/ai-research/services/research-agent.service';
import { RoleTargetEntity } from 'src/engine/metadata-modules/role-target/role-target.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { STANDARD_AGENT } from 'src/engine/workspace-manager/searm-standard-application/constants/standard-agent.constant';
import { STANDARD_ROLE } from 'src/engine/workspace-manager/searm-standard-application/constants/standard-role.constant';

describe('ResearchAgentService', () => {
  let service: ResearchAgentService;

  const agentRepository = { findOne: jest.fn() };
  const roleRepository = { findOne: jest.fn() };
  const roleTargetRepository = { findOne: jest.fn() };
  const aiAgentRoleService = { assignRoleToAgent: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    agentRepository.findOne.mockResolvedValue({ id: 'agent-seeded' });
    roleRepository.findOne.mockResolvedValue({ id: 'role-seeded' });
    roleTargetRepository.findOne.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchAgentService,
        { provide: getRepositoryToken(AgentEntity), useValue: agentRepository },
        { provide: getRepositoryToken(RoleEntity), useValue: roleRepository },
        {
          provide: getRepositoryToken(RoleTargetEntity),
          useValue: roleTargetRepository,
        },
        { provide: AiAgentRoleService, useValue: aiAgentRoleService },
      ],
    }).compile();

    service = module.get<ResearchAgentService>(ResearchAgentService);
  });

  // The literal duplication between the bootstrap constants and the feature
  // module is only safe if it is asserted.
  it('should use the same universal identifiers the workspace seed writes', () => {
    expect(STANDARD_AGENT.researcher.universalIdentifier).toBe(
      RESEARCH_AGENT_UNIVERSAL_IDENTIFIER,
    );
    expect(STANDARD_ROLE.aiResearcher.universalIdentifier).toBe(
      RESEARCH_AGENT_ROLE_UNIVERSAL_IDENTIFIER,
    );
  });

  it('should resolve the seeded agent by universal identifier and bind its role on first use', async () => {
    const agentId = await service.resolveResearchAgentId('workspace-1');

    expect(agentRepository.findOne).toHaveBeenCalledWith({
      where: {
        workspaceId: 'workspace-1',
        universalIdentifier: RESEARCH_AGENT_UNIVERSAL_IDENTIFIER,
      },
    });
    expect(aiAgentRoleService.assignRoleToAgent).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      agentId: 'agent-seeded',
      roleId: 'role-seeded',
    });
    expect(agentId).toBe('agent-seeded');
  });

  it('should not re-bind a role the agent already has', async () => {
    roleTargetRepository.findOne.mockResolvedValue({ id: 'role-target-1' });

    await service.resolveResearchAgentId('workspace-1');

    expect(aiAgentRoleService.assignRoleToAgent).not.toHaveBeenCalled();
    // The whole point of the pre-check: the expensive role lookup and the
    // flat-metadata migration behind it must not run on every dispatch.
    expect(roleRepository.findOne).not.toHaveBeenCalled();
  });

  // A workspace created before this task shipped has no researcher row. Fail
  // loudly and name the fix — never fall back to `agent: null`, which is the
  // degraded no-tools run Decision 4 exists to eliminate.
  it('should throw a named error when the workspace has no seeded research agent', async () => {
    agentRepository.findOne.mockResolvedValue(null);

    await expect(service.resolveResearchAgentId('workspace-1')).rejects.toThrow(
      /research agent is not seeded/i,
    );
  });

  it('should still return the agent id when the role row is missing, without binding', async () => {
    roleRepository.findOne.mockResolvedValue(null);

    const agentId = await service.resolveResearchAgentId('workspace-1');

    expect(agentId).toBe('agent-seeded');
    expect(aiAgentRoleService.assignRoleToAgent).not.toHaveBeenCalled();
  });
});
