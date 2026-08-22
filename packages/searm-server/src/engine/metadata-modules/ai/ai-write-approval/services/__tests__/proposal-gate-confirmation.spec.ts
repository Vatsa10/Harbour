import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { KeyValuePairService } from 'src/engine/core-modules/key-value-pair/key-value-pair.service';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { type ToolDescriptor } from 'src/engine/core-modules/tool-provider/types/tool-descriptor.type';
import { FactService } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import { AiWritePolicyService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/ai-write-policy.service';
import { ProposalGateService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service';
import { NotificationService } from 'src/engine/core-modules/notification/services/notification.service';
import { ProposalSupersessionService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-supersession.service';
import {
  buildDeleteConfirmationToken,
  buildDeleteFilterBasis,
} from 'src/engine/metadata-modules/ai/ai-write-approval/utils/build-delete-confirmation-token.util';

// The confirmation gate had no unit coverage at all: the only behavioural
// assertions live in an integration suite that needs a database, and the
// comparison could be deleted without turning a single runnable test red.
const context = {
  workspaceId: 'workspace-1',
  roleId: 'role-1',
  rolePermissionConfig: { unionOf: ['role-1'] },
  threadId: 'thread-1',
} satisfies ToolProviderContext;

const deleteDescriptor = (operation: 'delete_one' | 'delete_many') =>
  ({
    name: `${operation}_person`,
    label: operation,
    description: '',
    category: 'database',
    executionRef: {
      kind: 'database_crud',
      objectNameSingular: 'person',
      operation,
    },
  }) as unknown as ToolDescriptor;

const tokenFor = (basis: string | null) =>
  buildDeleteConfirmationToken({
    workspaceId: context.workspaceId,
    objectNameSingular: 'person',
    basis: basis ?? '',
  });

describe('ProposalGateService delete confirmation', () => {
  let service: ProposalGateService;

  const keyValuePairService = { get: jest.fn(), set: jest.fn() };
  const findRecordsService = { execute: jest.fn() };
  const factService = { findCurrentFactIdsForFields: jest.fn() };
  const proposalRepository = { findOne: jest.fn(), save: jest.fn() };
  const proposalItemRepository = { save: jest.fn(), find: jest.fn() };
  const notificationService = { raise: jest.fn().mockResolvedValue(undefined) };
  const proposalSupersessionService = {
    supersedeOverlappingItems: jest
      .fn()
      .mockResolvedValue({ supersededItemIds: [], supersededProposalIds: [] }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // AUTO is the only mode the confirmation gate applies to: PROPOSE already
    // stops at human review.
    keyValuePairService.get.mockResolvedValue([
      { value: { default: 'AUTO', overrides: {} } },
    ]);
    proposalRepository.findOne.mockResolvedValue(null);
    proposalRepository.save.mockResolvedValue({ id: 'proposal-1' });
    proposalItemRepository.save.mockResolvedValue({ id: 'item-1' });
    proposalItemRepository.find.mockResolvedValue([]);
    factService.findCurrentFactIdsForFields.mockResolvedValue([]);
    findRecordsService.execute.mockResolvedValue({
      success: true,
      message: 'ok',
      result: { records: [{ id: 'record-1' }] },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProposalGateService,
        AiWritePolicyService,
        { provide: KeyValuePairService, useValue: keyValuePairService },
        { provide: FindRecordsService, useValue: findRecordsService },
        { provide: FactService, useValue: factService },
        {
          provide: ProposalSupersessionService,
          useValue: proposalSupersessionService,
        },
        {
          provide: NotificationService,
          useValue: notificationService,
        },
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
  });

  const evaluate = (
    descriptor: ToolDescriptor,
    args: Record<string, unknown>,
  ) => service.evaluate({ descriptor, args, context });

  it('requires confirmation for an AUTO-policy delete_one with no token', async () => {
    const decision = await evaluate(deleteDescriptor('delete_one'), {
      id: 'record-1',
    });

    expect(decision.kind).toBe('CONFIRMATION_REQUIRED');

    if (decision.kind !== 'CONFIRMATION_REQUIRED') {
      throw new Error('expected a CONFIRMATION_REQUIRED decision');
    }

    expect(decision.failure.code).toBe('CONFIRMATION_REQUIRED');
    expect(decision.failure.retryable).toBe(true);
    expect(decision.failure.allowedActions).toEqual([
      'retry_with_confirm_token',
    ]);
  });

  it('allows the same delete_one once the correct token is supplied', async () => {
    const decision = await evaluate(deleteDescriptor('delete_one'), {
      id: 'record-1',
      confirm: tokenFor('record-1'),
    });

    expect(decision.kind).toBe('ALLOW');
  });

  it("rejects record A's token when used to delete record B", async () => {
    const decision = await evaluate(deleteDescriptor('delete_one'), {
      id: 'record-2',
      confirm: tokenFor('record-1'),
    });

    expect(decision.kind).toBe('CONFIRMATION_REQUIRED');
  });

  it('rejects a token minted for a narrow filter against a widened delete_many', async () => {
    const narrowFilter = { city: { eq: 'Paris' } };
    // A genuinely wider filter, not `{}` — an empty filter identifies nothing
    // and is refused outright (see the INVALID_ARGUMENTS test below).
    const widenedFilter = { country: { eq: 'France' } };

    const confirmed = await evaluate(deleteDescriptor('delete_many'), {
      filter: narrowFilter,
      confirm: tokenFor(buildDeleteFilterBasis(narrowFilter)),
    });

    expect(confirmed.kind).toBe('ALLOW');

    const widened = await evaluate(deleteDescriptor('delete_many'), {
      filter: widenedFilter,
      confirm: tokenFor(buildDeleteFilterBasis(narrowFilter)),
    });

    expect(widened.kind).toBe('CONFIRMATION_REQUIRED');
  });

  it('mints the same token regardless of filter key order', async () => {
    const decision = await evaluate(deleteDescriptor('delete_many'), {
      filter: { b: 2, a: 1 },
      confirm: tokenFor(buildDeleteFilterBasis({ a: 1, b: 2 })),
    });

    expect(decision.kind).toBe('ALLOW');
  });

  // M3: these three used to return ALLOW. A delete the gate cannot describe is
  // a delete the confirmation control cannot cover, so it must be refused
  // rather than exempted.
  it('refuses a delete_one whose id is not a string instead of exempting it', async () => {
    const decision = await evaluate(deleteDescriptor('delete_one'), {
      id: { eq: 'record-1' },
    });

    expect(decision.kind).toBe('FORBID');

    if (decision.kind !== 'FORBID') {
      throw new Error('expected a FORBID decision');
    }

    expect(decision.failure.code).toBe('INVALID_ARGUMENTS');
  });

  it('refuses a delete_one with no id at all', async () => {
    const decision = await evaluate(deleteDescriptor('delete_one'), {});

    expect(decision.kind).toBe('FORBID');
  });

  it('refuses a delete_many with an empty filter', async () => {
    const decision = await evaluate(deleteDescriptor('delete_many'), {
      filter: {},
    });

    expect(decision.kind).toBe('FORBID');

    if (decision.kind !== 'FORBID') {
      throw new Error('expected a FORBID decision');
    }

    expect(decision.failure.code).toBe('INVALID_ARGUMENTS');
  });
});
