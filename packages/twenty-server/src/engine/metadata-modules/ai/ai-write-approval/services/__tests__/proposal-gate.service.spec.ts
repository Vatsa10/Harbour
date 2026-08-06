import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { KeyValuePairService } from 'src/engine/core-modules/key-value-pair/key-value-pair.service';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { type ToolDescriptor } from 'src/engine/core-modules/tool-provider/types/tool-descriptor.type';
import { getWorkspaceScopedRepositoryToken } from 'src/engine/twenty-orm/workspace-scoped-repository/get-workspace-scoped-repository-token.util';
import { EvidenceEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/evidence.entity';
import { FactEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/fact.entity';
import { FactService } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
import { FactStatus } from 'src/engine/metadata-modules/ai/ai-research/types/fact-status.type';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import { AiWritePolicyService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/ai-write-policy.service';
import { ProposalGateService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service';
import { type AiWritePolicy } from 'src/engine/metadata-modules/ai/ai-write-approval/types/ai-write-policy.type';

const context = {
  workspaceId: 'workspace-1',
  roleId: 'role-1',
  rolePermissionConfig: { unionOf: ['role-1'] },
  threadId: 'thread-1',
} satisfies ToolProviderContext;

const crudDescriptor = (
  operation: string,
  objectNameSingular = 'person',
): ToolDescriptor =>
  ({
    name: `${operation}_${objectNameSingular}`,
    label: operation,
    description: '',
    category: 'database',
    executionRef: {
      kind: 'database_crud',
      objectNameSingular,
      operation,
    },
  }) as unknown as ToolDescriptor;

const staticDescriptor = (
  toolId: string,
  category = 'action',
): ToolDescriptor =>
  ({
    name: toolId,
    label: toolId,
    description: '',
    category,
    executionRef: { kind: 'static', toolId },
  }) as unknown as ToolDescriptor;

describe('ProposalGateService', () => {
  let service: ProposalGateService;
  let policyService: AiWritePolicyService;

  // The policy service is REAL here. Mocking resolveMode is what let the
  // gate → policy seam ship broken: the gate built keys the policy could
  // never match and every test agreed with the mock.
  const keyValuePairService = { get: jest.fn(), set: jest.fn() };
  const findRecordsService = { execute: jest.fn() };
  const factService = { findCurrentFactIdsForFields: jest.fn() };
  const proposalRepository = { findOne: jest.fn(), save: jest.fn() };
  const proposalItemRepository = { save: jest.fn() };

  const setPolicy = (policy: AiWritePolicy) => {
    keyValuePairService.get.mockResolvedValue([{ value: policy }]);
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    setPolicy({ default: 'PROPOSE', overrides: {} });
    proposalRepository.findOne.mockResolvedValue(null);
    factService.findCurrentFactIdsForFields.mockResolvedValue([]);
    proposalRepository.save.mockImplementation(async (entity) => ({
      ...entity,
      id: 'proposal-1',
    }));
    proposalItemRepository.save.mockImplementation(async (entity) => ({
      ...entity,
      id: 'item-1',
    }));
    findRecordsService.execute.mockResolvedValue({
      success: true,
      message: 'ok',
      result: { records: [{ id: 'record-1', jobTitle: 'Old title' }] },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProposalGateService,
        AiWritePolicyService,
        { provide: KeyValuePairService, useValue: keyValuePairService },
        { provide: FindRecordsService, useValue: findRecordsService },
        { provide: FactService, useValue: factService },
        {
          provide: getRepositoryToken(ProposalEntity),
          useValue: proposalRepository,
        },
        {
          provide: getRepositoryToken(ProposalItemEntity),
          useValue: proposalItemRepository,
        },
      ],
    }).compile();

    service = module.get<ProposalGateService>(ProposalGateService);
    policyService = module.get<AiWritePolicyService>(AiWritePolicyService);
  });

  const evaluate = (
    descriptor: ToolDescriptor,
    args: Record<string, unknown>,
  ) => service.evaluate({ descriptor, args, context });

  const savedItem = () => proposalItemRepository.save.mock.calls[0][0];

  describe('reads', () => {
    it.each(['find_many', 'find_one', 'group_by'])(
      'should allow %s without consulting the policy',
      async (operation) => {
        const getPolicySpy = jest.spyOn(policyService, 'getPolicy');

        const decision = await evaluate(crudDescriptor(operation), {});

        expect(decision.kind).toBe('ALLOW');
        expect(getPolicySpy).not.toHaveBeenCalled();
      },
    );
  });

  describe('policy resolution through the real policy service', () => {
    it('should honour a field-level AUTO override and write directly', async () => {
      setPolicy({
        default: 'PROPOSE',
        overrides: { 'person.linkedinLink': 'AUTO' },
      });

      const decision = await evaluate(crudDescriptor('update_one'), {
        id: 'record-1',
        linkedinLink: 'https://example.com',
      });

      expect(decision.kind).toBe('ALLOW');
      expect(proposalItemRepository.save).not.toHaveBeenCalled();
    });

    it('should honour an object-level AUTO override', async () => {
      setPolicy({ default: 'PROPOSE', overrides: { person: 'AUTO' } });

      const decision = await evaluate(crudDescriptor('update_one'), {
        id: 'record-1',
        jobTitle: 'New title',
      });

      expect(decision.kind).toBe('ALLOW');
    });

    it('should still propose a field the AUTO override does not cover', async () => {
      setPolicy({
        default: 'PROPOSE',
        overrides: { 'person.linkedinLink': 'AUTO' },
      });

      const decision = await evaluate(crudDescriptor('update_one'), {
        id: 'record-1',
        linkedinLink: 'https://example.com',
        jobTitle: 'New title',
      });

      expect(decision.kind).toBe('PROPOSED');
    });

    it('should forbid a write when the policy resolves to FORBID', async () => {
      setPolicy({ default: 'FORBID', overrides: {} });

      const decision = await evaluate(crudDescriptor('update_one'), {
        id: 'record-1',
        jobTitle: 'New title',
      });

      expect(decision.kind).toBe('FORBID');
      if (decision.kind !== 'FORBID') {
        throw new Error('expected a forbid decision');
      }
      expect(decision.failure.code).toBe('FORBIDDEN_BY_POLICY');
      expect(decision.failure.retryable).toBe(false);
      expect(proposalItemRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('proposal capture', () => {
    it('should propose an update, storing the payload and the baseline', async () => {
      const decision = await evaluate(crudDescriptor('update_one'), {
        id: 'record-1',
        jobTitle: 'New title',
      });

      expect(decision.kind).toBe('PROPOSED');
      expect(savedItem()).toMatchObject({
        actionType: 'UPDATE_RECORD',
        objectNameSingular: 'person',
        recordId: 'record-1',
        payload: { jobTitle: 'New title' },
        baseline: { jobTitle: 'Old title' },
      });
    });

    it('should return a success-shaped output so the agent does not retry', async () => {
      const decision = await evaluate(crudDescriptor('update_one'), {
        id: 'record-1',
        jobTitle: 'New title',
      });

      if (decision.kind !== 'PROPOSED') {
        throw new Error('expected a proposed decision');
      }

      expect(decision.output.success).toBe(true);
      expect(decision.output.message).toContain('awaiting human approval');
    });

    it('should reuse one pending proposal for every call in the same thread', async () => {
      proposalRepository.findOne.mockResolvedValue({ id: 'proposal-existing' });

      await evaluate(crudDescriptor('update_one'), {
        id: 'record-1',
        jobTitle: 'New title',
      });

      expect(proposalRepository.save).not.toHaveBeenCalled();
      expect(savedItem()).toMatchObject({ proposalId: 'proposal-existing' });
    });

    // A delete carries no proposed values, so without this the record could be
    // edited by a human and still silently deleted on approval.
    it('should capture a staleness baseline for a delete', async () => {
      findRecordsService.execute.mockResolvedValue({
        success: true,
        message: 'ok',
        result: { records: [{ id: 'record-1', updatedAt: '2026-01-01' }] },
      });

      await evaluate(crudDescriptor('delete_one'), { id: 'record-1' });

      expect(savedItem()).toMatchObject({
        actionType: 'DELETE_RECORD',
        recordId: 'record-1',
        baseline: { updatedAt: '2026-01-01' },
      });
    });
  });

  // C3: the stored payload must replay the real call. It used to be the policy
  // projection, which merged a batch of records into one and dropped filters.
  describe('bulk operations store a replayable payload', () => {
    it('should keep every record of a create_many', async () => {
      const records = [
        { name: 'A', city: 'Berlin' },
        { name: 'B', jobTitle: 'Lead' },
      ];

      await evaluate(crudDescriptor('create_many'), { records });

      expect(savedItem()).toMatchObject({
        actionType: 'CREATE_RECORDS',
        payload: { records },
      });
    });

    it('should keep every record of an upsert_many and mark it as an upsert', async () => {
      const records = [{ name: 'A' }, { name: 'B' }];

      await evaluate(crudDescriptor('upsert_many'), { records });

      expect(savedItem()).toMatchObject({
        actionType: 'UPSERT_RECORDS',
        payload: { records },
      });
    });

    it('should keep the filter of an update_many', async () => {
      const filter = { city: { eq: 'Berlin' } };

      await evaluate(crudDescriptor('update_many'), {
        filter,
        data: { jobTitle: 'Lead' },
      });

      expect(savedItem()).toMatchObject({
        actionType: 'UPDATE_RECORDS',
        payload: { filter, data: { jobTitle: 'Lead' } },
      });
    });

    it('should keep the filter of a delete_many', async () => {
      const filter = { city: { eq: 'Berlin' } };

      await evaluate(crudDescriptor('delete_many'), { filter });

      expect(savedItem()).toMatchObject({
        actionType: 'DELETE_RECORDS',
        payload: { filter },
      });
    });

    it('should resolve the policy from every field in the batch', async () => {
      setPolicy({ default: 'AUTO', overrides: { 'person.email': 'FORBID' } });

      const decision = await evaluate(crudDescriptor('create_many'), {
        records: [{ name: 'A' }, { email: 'b@example.com' }],
      });

      expect(decision.kind).toBe('FORBID');
    });
  });

  // I6: the gate is a denylist. Anything not classified read-only is gated.
  // The citation link: a reviewer must be able to see WHY a change was
  // proposed. Without this the approval screen shows a diff with no provenance,
  // which is the product's entire differentiator missing.
  describe('fact citations', () => {
    it('should attach the facts standing for the touched fields', async () => {
      setPolicy({ default: 'PROPOSE', overrides: {} });
      factService.findCurrentFactIdsForFields.mockResolvedValue([
        'fact-1',
        'fact-2',
      ]);

      await service.evaluate({
        descriptor: crudDescriptor('update_one'),
        args: { id: 'record-1', jobTitle: 'Head of Sales' },
        context,
      });

      expect(factService.findCurrentFactIdsForFields).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        objectNameSingular: 'person',
        recordId: 'record-1',
        fieldNames: ['jobTitle'],
      });
      expect(proposalItemRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ factIds: ['fact-1', 'fact-2'] }),
      );
    });

    it('should store an empty citation list for a write with no research behind it', async () => {
      setPolicy({ default: 'PROPOSE', overrides: {} });

      await service.evaluate({
        descriptor: crudDescriptor('update_one'),
        args: { id: 'record-1', jobTitle: 'Head of Sales' },
        context,
      });

      expect(proposalItemRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ factIds: [] }),
      );
    });
  });

  // These two tools write platform tables, never a CRM record. If the gate
  // catches them, the agent is asked to approve the act of writing down an
  // observation, no evidence is ever recorded, and the whole evidence → fact →
  // proposal chain goes inert while every other test stays green.
  describe('platform-table tools stay ungated', () => {
    it.each(['record_evidence', 'create_agent_task'])(
      'should not gate %s even when the policy says PROPOSE',
      async (toolId) => {
        setPolicy({ default: 'PROPOSE', overrides: {} });

        const decision = await service.evaluate({
          descriptor: staticDescriptor(toolId),
          args: { recordId: 'record-1', fieldName: 'employees', value: 250 },
          context,
        });

        expect(decision.kind).toBe('ALLOW');
        expect(proposalItemRepository.save).not.toHaveBeenCalled();
      },
    );

    it('should still gate an unenumerated static tool under the same policy', async () => {
      setPolicy({ default: 'PROPOSE', overrides: {} });

      const decision = await service.evaluate({
        descriptor: staticDescriptor('some_future_write_tool'),
        args: { to: 'a@example.com' },
        context,
      });

      expect(decision.kind).toBe('PROPOSED');
    });
  });

  describe('denylist', () => {
    it('should gate a CRUD operation nobody has classified', async () => {
      const decision = await evaluate(crudDescriptor('merge_many'), {
        ids: ['a', 'b'],
      });

      expect(decision.kind).toBe('PROPOSED');
    });

    it('should gate an unknown static tool', async () => {
      const decision = await evaluate(
        staticDescriptor('brand_new_write_tool'),
        {
          anything: true,
        },
      );

      expect(decision.kind).toBe('PROPOSED');
      expect(savedItem()).toMatchObject({
        actionType: 'STATIC_TOOL',
        toolId: 'brand_new_write_tool',
        toolCategory: 'action',
        payload: { anything: true },
      });
    });

    it('should gate a metadata write tool', async () => {
      const decision = await evaluate(staticDescriptor('create_view', 'view'), {
        name: 'My view',
      });

      expect(decision.kind).toBe('PROPOSED');
    });

    it.each([
      'search_help_center',
      'navigate_app',
      'extract_json_paths',
      'search_output',
      'code_interpreter',
      'get_views',
      'list_workflows',
      'list_roles',
    ])('should let the read-only tool %s through ungated', async (toolId) => {
      const decision = await evaluate(staticDescriptor(toolId), {});

      expect(decision.kind).toBe('ALLOW');
    });

    it('should let a GET http_request through and gate every other method', async () => {
      const read = await evaluate(staticDescriptor('http_request'), {
        url: 'https://example.com',
        method: 'GET',
      });

      expect(read.kind).toBe('ALLOW');

      const write = await evaluate(staticDescriptor('http_request'), {
        url: 'https://example.com',
        method: 'POST',
      });

      expect(write.kind).toBe('PROPOSED');
    });

    it('should gate send_email as an outbound send', async () => {
      const decision = await evaluate(staticDescriptor('send_email'), {
        to: 'a@example.com',
      });

      expect(decision.kind).toBe('PROPOSED');
      expect(savedItem()).toMatchObject({ actionType: 'SEND_EMAIL' });
    });
  });

  // Everything above mocks FactService, so it doubles the very seam this task
  // adds. These run the gate against the REAL FactService with only the
  // repositories stubbed, which is what catches a param-name or short-circuit
  // mismatch between the two sides.
  describe('fact citations through the real fact service', () => {
    const factRepository = { find: jest.fn(), update: jest.fn() };
    const evidenceRepository = { find: jest.fn() };
    let realGate: ProposalGateService;

    beforeEach(async () => {
      // Stands in for the database rather than returning a fixed row: a
      // repository that answers every query would make the "no citations for
      // an outbound send" case below pass against a gate that cited facts
      // from an unrelated record.
      factRepository.find.mockImplementation(
        async (
          workspaceId: string,
          options: {
            where: {
              objectNameSingular: string;
              recordId: string;
              fieldName: { _value: string[] };
              status: FactStatus;
            };
          },
        ) => {
          const { where } = options;
          const matches =
            workspaceId === 'workspace-1' &&
            where.objectNameSingular === 'person' &&
            where.recordId === 'record-1' &&
            where.status === FactStatus.CURRENT &&
            where.fieldName._value.includes('jobTitle');

          return matches ? [{ id: 'fact-1' }] : [];
        },
      );

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ProposalGateService,
          AiWritePolicyService,
          FactService,
          { provide: KeyValuePairService, useValue: keyValuePairService },
          { provide: FindRecordsService, useValue: findRecordsService },
          {
            provide: getRepositoryToken(ProposalEntity),
            useValue: proposalRepository,
          },
          {
            provide: getRepositoryToken(ProposalItemEntity),
            useValue: proposalItemRepository,
          },
          {
            provide: getWorkspaceScopedRepositoryToken(FactEntity),
            useValue: factRepository,
          },
          {
            provide: getWorkspaceScopedRepositoryToken(EvidenceEntity),
            useValue: evidenceRepository,
          },
        ],
      }).compile();

      realGate = module.get<ProposalGateService>(ProposalGateService);
    });

    it('should query facts scoped to the workspace, record and touched fields', async () => {
      await realGate.evaluate({
        descriptor: crudDescriptor('update_one'),
        args: { id: 'record-1', jobTitle: 'Head of Sales' },
        context,
      });

      expect(factRepository.find).toHaveBeenCalledWith('workspace-1', {
        where: {
          objectNameSingular: 'person',
          recordId: 'record-1',
          fieldName: expect.objectContaining({ _value: ['jobTitle'] }),
          status: FactStatus.CURRENT,
        },
      });
      expect(savedItem()).toMatchObject({ factIds: ['fact-1'] });
    });

    // An outbound send has no record to cite facts against. It must store an
    // empty list rather than fabricate a justification — and must not run a
    // query with an empty object/record key either.
    it('should store no citations for an outbound send', async () => {
      const decision = await realGate.evaluate({
        descriptor: staticDescriptor('send_email'),
        args: { to: 'a@example.com', subject: 'Hi' },
        context,
      });

      expect(decision.kind).toBe('PROPOSED');
      expect(savedItem()).toMatchObject({ factIds: [] });
    });

    // A delete proposes no field values, so there is nothing to cite. The
    // short-circuit must keep this off the database entirely.
    it('should not query at all for a delete', async () => {
      await realGate.evaluate({
        descriptor: crudDescriptor('delete_one'),
        args: { id: 'record-1' },
        context,
      });

      expect(factRepository.find).not.toHaveBeenCalled();
      expect(savedItem()).toMatchObject({ factIds: [] });
    });
  });
});
