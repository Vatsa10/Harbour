import {
  RESEARCH_AGENT_ROLE_UNIVERSAL_IDENTIFIER,
  RESEARCH_AGENT_UNIVERSAL_IDENTIFIER,
} from 'src/engine/metadata-modules/ai/ai-research/constants/research-agent.const';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';

// Real-seam test. The ResearchAgentService spec doubles every repository, so it
// can only prove the resolver reads the right universal identifier — it cannot
// prove anything ever writes a row under it. This one runs the actual
// standard-application flat-metadata pipeline end to end with no mocks, which
// is what the workspace seed and every workspace sync run. If the researcher
// agent or the AI Researcher role stopped being emitted, or the role lost the
// two flags the agent needs to receive tools and to propose, this fails.
describe('research agent standard-application seed', () => {
  const { allFlatEntityMaps, idByUniversalIdentifierByMetadataName } =
    computeTwentyStandardApplicationAllFlatEntityMaps({
      now: '2026-08-06T00:00:00.000Z',
      workspaceId: '20202020-1111-4111-8111-111111111111',
      twentyStandardApplicationId: '20202020-2222-4222-8222-222222222222',
    });

  it('should emit the researcher agent under the identifier the resolver looks up', () => {
    const agent =
      allFlatEntityMaps.flatAgentMaps.byUniversalIdentifier[
        RESEARCH_AGENT_UNIVERSAL_IDENTIFIER
      ];

    expect(agent).toBeDefined();
    expect(agent?.name).toBe('researcher');
  });

  it('should emit the AI Researcher role assignable to agents', () => {
    const role =
      allFlatEntityMaps.flatRoleMaps.byUniversalIdentifier[
        RESEARCH_AGENT_ROLE_UNIVERSAL_IDENTIFIER
      ];

    expect(role).toBeDefined();
    expect(role?.label).toBe('AI Researcher');
    // Without this, AiAgentRoleService.assignRoleToAgent throws
    // ROLE_CANNOT_BE_ASSIGNED_TO_AGENTS and the agent stays role-less, which
    // means zero registry tools — no record_evidence, no update tools at all.
    expect(role?.canBeAssignedToAgents).toBe(true);
  });

  it('should grant the role read plus the object-write permission the write tools are generated from, and nothing destructive', () => {
    const role =
      allFlatEntityMaps.flatRoleMaps.byUniversalIdentifier[
        RESEARCH_AGENT_ROLE_UNIVERSAL_IDENTIFIER
      ];

    expect(role?.canReadAllObjectRecords).toBe(true);
    // DatabaseToolProvider gates the entire create/update descriptor block on
    // this flag. False here means no write tool exists, so the agent could
    // never trip ProposalGateService and never produce a proposal.
    expect(role?.canUpdateAllObjectRecords).toBe(true);
    expect(role?.canSoftDeleteAllObjectRecords).toBe(false);
    expect(role?.canDestroyAllObjectRecords).toBe(false);
    expect(role?.canUpdateAllSettings).toBe(false);
  });

  it('should carry both identifiers into the migration id map, proving the pipeline actually persists them', () => {
    expect(
      idByUniversalIdentifierByMetadataName.agent?.[
        RESEARCH_AGENT_UNIVERSAL_IDENTIFIER
      ],
    ).toBeDefined();
    expect(
      idByUniversalIdentifierByMetadataName.role?.[
        RESEARCH_AGENT_ROLE_UNIVERSAL_IDENTIFIER
      ],
    ).toBeDefined();
  });

  // roleTarget is absent from TWENTY_STANDARD_ALL_METADATA_NAME, which is the
  // whole reason ResearchAgentService binds the role at run time instead. If
  // this ever starts failing, the run-time binding can be deleted.
  it('should NOT emit a role target, so the run-time binding remains necessary', () => {
    const role =
      allFlatEntityMaps.flatRoleMaps.byUniversalIdentifier[
        RESEARCH_AGENT_ROLE_UNIVERSAL_IDENTIFIER
      ];

    expect(role?.roleTargetIds).toEqual([]);
  });
});
