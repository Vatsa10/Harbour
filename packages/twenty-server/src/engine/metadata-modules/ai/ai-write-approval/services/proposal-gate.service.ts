import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { Repository } from 'typeorm';

import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { type ToolDescriptor } from 'src/engine/core-modules/tool-provider/types/tool-descriptor.type';
import { type ToolIndexEntry } from 'src/engine/core-modules/tool-provider/types/tool-index-entry.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import { AiWritePolicyService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/ai-write-policy.service';
import {
  PROPOSAL_TTL_DAYS,
  ProposalActionType,
  ProposalItemStatus,
  ProposalStatus,
} from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

export type GateDecision =
  | { kind: 'ALLOW' }
  | { kind: 'FORBID'; message: string }
  | { kind: 'PROPOSED'; output: ToolOutput };

// Reads are never gated. Everything else that mutates is.
const GATED_CRUD_OPERATIONS = [
  'create_one',
  'create_many',
  'update_one',
  'update_many',
  'upsert_many',
  'delete_one',
  'delete_many',
] as const;

// Static tools with side effects outside the CRM.
const GATED_STATIC_TOOL_IDS = ['send_email', 'create_calendar_event'] as const;

const CRUD_OPERATION_TO_ACTION_TYPE: Record<string, ProposalActionType> = {
  create_one: ProposalActionType.CREATE_RECORD,
  create_many: ProposalActionType.CREATE_RECORD,
  update_one: ProposalActionType.UPDATE_RECORD,
  update_many: ProposalActionType.UPDATE_RECORD,
  upsert_many: ProposalActionType.CREATE_RECORD,
  delete_one: ProposalActionType.DELETE_RECORD,
  delete_many: ProposalActionType.DELETE_RECORD,
};

const STATIC_TOOL_ID_TO_ACTION_TYPE: Record<string, ProposalActionType> = {
  send_email: ProposalActionType.SEND_EMAIL,
  create_calendar_event: ProposalActionType.CREATE_CALENDAR_EVENT,
};

@Injectable()
export class ProposalGateService {
  private readonly logger = new Logger(ProposalGateService.name);

  constructor(
    private readonly aiWritePolicyService: AiWritePolicyService,
    private readonly findRecordsService: FindRecordsService,
    // Proposals are looked up by (workspaceId, threadId, status) as a single
    // composite condition, not workspaceId-then-filter, so the scoped wrapper's
    // "workspaceId first, merge rest" shape doesn't fit this access pattern.
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(ProposalEntity)
    private readonly proposalRepository: Repository<ProposalEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(ProposalItemEntity)
    private readonly proposalItemRepository: Repository<ProposalItemEntity>,
  ) {}

  async evaluate(params: {
    descriptor: ToolIndexEntry | ToolDescriptor;
    args: Record<string, unknown>;
    context: ToolProviderContext;
  }): Promise<GateDecision> {
    const { descriptor, args, context } = params;
    const { executionRef } = descriptor;

    const gateInput = this.buildGateInput(executionRef, args);

    if (!isDefined(gateInput)) {
      return { kind: 'ALLOW' };
    }

    const policy = await this.aiWritePolicyService.getPolicy(
      context.workspaceId,
    );
    const mode = this.aiWritePolicyService.resolveMode(policy, gateInput.keys);

    if (mode === 'AUTO') {
      return { kind: 'ALLOW' };
    }

    if (mode === 'FORBID') {
      return {
        kind: 'FORBID',
        message: `This workspace does not permit AI to perform "${descriptor.name}". Ask a workspace admin to change the AI write policy.`,
      };
    }

    const baseline = await this.readBaseline({
      objectNameSingular: gateInput.objectNameSingular,
      recordId: gateInput.recordId,
      fieldNames: Object.keys(gateInput.payload),
      context,
    });

    const proposal = await this.getOrCreatePendingProposal(context);

    const item = await this.proposalItemRepository.save({
      proposalId: proposal.id,
      actionType: gateInput.actionType,
      objectNameSingular: gateInput.objectNameSingular,
      recordId: gateInput.recordId,
      payload: gateInput.payload,
      baseline,
      status: ProposalItemStatus.PENDING,
    });

    return {
      kind: 'PROPOSED',
      output: {
        success: true,
        message:
          'Change proposed and awaiting human approval. Do not retry this write.',
        result: {
          proposalId: proposal.id,
          proposalItemId: item.id,
          status: ProposalItemStatus.PENDING,
        },
      },
    };
  }

  private buildGateInput(
    executionRef: ToolIndexEntry['executionRef'],
    args: Record<string, unknown>,
  ): {
    keys: string[];
    actionType: ProposalActionType;
    objectNameSingular: string | null;
    recordId: string | null;
    payload: Record<string, unknown>;
  } | null {
    if (executionRef.kind === 'database_crud') {
      const isGated = GATED_CRUD_OPERATIONS.some(
        (operation) => operation === executionRef.operation,
      );

      if (!isGated) {
        return null;
      }

      const objectNameSingular = executionRef.objectNameSingular;
      const { id, ...rest } = args;

      // Bulk operations wrap their fields differently: update_many takes
      // { filter, data }, create_many/upsert_many take { records }. Unwrap so
      // policy keys are real field names, not the envelope's own keys.
      const payload = this.extractPayload(executionRef.operation, rest);

      const fieldKeys = Object.keys(payload).map(
        (fieldName) => `${objectNameSingular}.${fieldName}`,
      );

      return {
        keys: [objectNameSingular, ...fieldKeys],
        actionType: CRUD_OPERATION_TO_ACTION_TYPE[executionRef.operation],
        objectNameSingular,
        recordId: typeof id === 'string' ? id : null,
        payload,
      };
    }

    if (executionRef.kind === 'static') {
      const isGated = GATED_STATIC_TOOL_IDS.some(
        (toolId) => toolId === executionRef.toolId,
      );

      if (!isGated) {
        return null;
      }

      return {
        keys: [executionRef.toolId],
        actionType: STATIC_TOOL_ID_TO_ACTION_TYPE[executionRef.toolId],
        objectNameSingular: null,
        recordId: null,
        payload: args,
      };
    }

    return null;
  }

  // update_many wraps its fields in `data`; create_many and upsert_many wrap
  // an array of records. Everything else is already a flat field map.
  private extractPayload(
    operation: string,
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    if (operation === 'update_many') {
      const data = args.data;

      return typeof data === 'object' && data !== null
        ? (data as Record<string, unknown>)
        : {};
    }

    if (operation === 'create_many' || operation === 'upsert_many') {
      const records = args.records;

      if (!Array.isArray(records)) {
        return {};
      }

      // Union of every record's fields, so one risky field anywhere in the
      // batch still resolves the policy for the whole write.
      return Object.fromEntries(
        records.flatMap((record) =>
          typeof record === 'object' && record !== null
            ? Object.entries(record as Record<string, unknown>)
            : [],
        ),
      );
    }

    if (operation === 'delete_many') {
      return {};
    }

    return args;
  }

  // Reads the fields the write would change, so approval can detect that a
  // human edited them in the meantime. Uses the agent's own role config, so a
  // field the agent cannot read never lands in the baseline.
  private async readBaseline(params: {
    objectNameSingular: string | null;
    recordId: string | null;
    fieldNames: string[];
    context: ToolProviderContext;
  }): Promise<Record<string, unknown>> {
    const { objectNameSingular, recordId, fieldNames, context } = params;

    if (
      !isDefined(objectNameSingular) ||
      !isDefined(recordId) ||
      fieldNames.length === 0
    ) {
      return {};
    }

    const output = await this.findRecordsService.execute({
      objectName: objectNameSingular,
      filter: { id: { eq: recordId } },
      limit: 1,
      select: fieldNames,
      shouldBuildEffectiveSelectFields: true,
      authContext: buildSystemAuthContext(context.workspaceId),
      rolePermissionConfig: context.rolePermissionConfig,
    });

    if (!output.success) {
      this.logger.warn(
        `Could not read baseline for ${objectNameSingular}:${recordId} — ${output.error}`,
      );

      return {};
    }

    const records = (output.result as { records?: Record<string, unknown>[] })
      ?.records;
    const record = records?.[0];

    if (!isDefined(record)) {
      return {};
    }

    return Object.fromEntries(
      fieldNames.map((fieldName) => [fieldName, record[fieldName]]),
    );
  }

  // One agent turn produces one reviewable batch rather than one proposal per
  // tool call. Falls back to a fresh proposal when there is no thread to key on.
  private async getOrCreatePendingProposal(
    context: ToolProviderContext,
  ): Promise<ProposalEntity> {
    if (isDefined(context.threadId)) {
      const existing = await this.proposalRepository.findOne({
        where: {
          workspaceId: context.workspaceId,
          threadId: context.threadId,
          status: ProposalStatus.PENDING,
        },
      });

      if (isDefined(existing)) {
        return existing;
      }
    }

    const expiresAt = new Date();

    expiresAt.setDate(expiresAt.getDate() + PROPOSAL_TTL_DAYS);

    return this.proposalRepository.save({
      workspaceId: context.workspaceId,
      threadId: context.threadId ?? null,
      createdByActor: context.actorContext ?? null,
      status: ProposalStatus.PENDING,
      expiresAt,
    });
  }
}
