import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { Repository } from 'typeorm';

import { NotificationService } from 'src/engine/core-modules/notification/services/notification.service';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { type ToolDescriptor } from 'src/engine/core-modules/tool-provider/types/tool-descriptor.type';
import { type ToolIndexEntry } from 'src/engine/core-modules/tool-provider/types/tool-index-entry.type';
import { buildToolFailure } from 'src/engine/core-modules/tool/utils/build-tool-failure.util';
import { type ToolFailure } from 'src/engine/core-modules/tool/types/tool-failure.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { FactService } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import { AiWritePolicyService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/ai-write-policy.service';
import { ProposalSupersessionService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-supersession.service';
import { type AiWritePolicyTarget } from 'src/engine/metadata-modules/ai/ai-write-approval/types/ai-write-policy.type';
import { buildProposalNotification } from 'src/engine/metadata-modules/ai/ai-write-approval/utils/build-proposal-notification.util';
import {
  buildDeleteConfirmationToken,
  buildDeleteFilterBasis,
} from 'src/engine/metadata-modules/ai/ai-write-approval/utils/build-delete-confirmation-token.util';
import {
  PROPOSAL_TTL_DAYS,
  ProposalActionType,
  ProposalItemStatus,
  ProposalStatus,
} from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { isPostgresUniqueViolation } from 'src/utils/is-postgres-unique-violation.util';

export type GateDecision =
  | { kind: 'ALLOW' }
  | { kind: 'FORBID'; failure: ToolFailure }
  | { kind: 'CONFIRMATION_REQUIRED'; failure: ToolFailure }
  | { kind: 'PROPOSED'; output: ToolOutput };

type GateInput = {
  target: AiWritePolicyTarget;
  actionType: ProposalActionType;
  objectNameSingular: string | null;
  recordId: string | null;
  toolId: string | null;
  toolCategory: string | null;
  // Exactly what approval replays. Never a policy projection.
  payload: Record<string, unknown>;
  // Fields snapshotted so approval can detect a human edit in between.
  baselineFieldNames: string[];
  // AI-requested deletes only. `confirmationBasis` is what the token hashes
  // over — the record id for delete_one, the stringified filter for
  // delete_many. Absent on every other branch, which is what keeps the
  // confirmation check scoped to deletes.
  confirm?: string | null;
  confirmationBasis?: string | null;
  // Set only by the buildCrudGateInput fallback branch, for a CRUD operation
  // string that matches none of the known ones. There is no toolId to record
  // and no apply-time code path that knows how to replay it, so a proposal
  // item built from this input could never be approved — it would sit FAILED
  // forever, unrejectable, after the very first approval attempt. Caught in
  // evaluate() before any proposal or item is written.
  unclassified?: boolean;
};

// Denylist, not allowlist: every CRUD operation is gated except these three
// reads. A newly added CRUD operation is therefore gated by default.
const UNGATED_CRUD_OPERATIONS = ['find_many', 'find_one', 'group_by'] as const;

// The inverse of the old allowlist. A static tool is gated unless it appears
// here, so a newly registered tool is gated until someone classifies it.
// Every entry below was checked against its implementation for external or
// persistent writes.
const UNGATED_STATIC_TOOL_IDS = [
  // action tools
  'search_help_center',
  'navigate_app',
  'extract_json_paths',
  'search_output',
  // record_evidence writes only to core."evidence" and the facts derived from
  // it. It never touches a CRM record and never sends anything outbound. Gating
  // it would ask a human to approve the act of writing down an observation, and
  // no evidence would ever be recorded — the whole pipeline goes inert.
  'record_evidence',
  // create_agent_task schedules research. It writes core."agentTask" and, via
  // ResearchAgentService.ensureRoleBinding -> AiAgentRoleService, one
  // roleTarget row plus the flat-metadata workspace migration that binds the
  // seeded research agent to its seeded role. No model input reaches roleId or
  // agentId (both resolve from server-side universal identifiers) and the
  // binding is idempotent and once-per-workspace, so this is not a write path
  // a model can steer — but it is more than core."agentTask", and a reviewer
  // re-approving this exemption should be told so.
  // it never touches a CRM record and never sends anything outbound. The
  // research run it schedules is itself dispatched through this same gate, so
  // exempting the scheduling call does not exempt any write.
  'create_agent_task',
  // code_interpreter runs sandboxed compute. It has no CRM repository access
  // and no outbound network write path, so it is classified read-only here
  // rather than re-derived on every review.
  'code_interpreter',
  // view reads
  'get_views',
  'get_view_query_parameters',
  'get_view_fields',
  'get_view_filters',
  'get_view_sorts',
  // metadata reads
  'get_object_metadata',
  'get_field_metadata',
  // workflow reads
  'get_workflow_current_version',
  'get_workflow_run',
  'list_workflows',
  'list_workflow_runs',
  'get_logic_function_source',
  'list_logic_function_tools',
  'compute_step_output_schema',
  'validate_workflow',
  // dashboard reads
  'get_dashboard',
  'list_dashboards',
  // webhook / role / navigation reads
  'list_webhooks',
  'list_roles',
  'list_navigation_menu_items',
] as const;

// http_request is dual-use: research reads pass, outbound writes are gated.
const UNGATED_HTTP_METHODS = ['GET', 'HEAD'] as const;

const CRUD_OPERATION_TO_ACTION_TYPE: Record<string, ProposalActionType> = {
  create_one: ProposalActionType.CREATE_RECORD,
  create_many: ProposalActionType.CREATE_RECORDS,
  update_one: ProposalActionType.UPDATE_RECORD,
  update_many: ProposalActionType.UPDATE_RECORDS,
  upsert_many: ProposalActionType.UPSERT_RECORDS,
  delete_one: ProposalActionType.DELETE_RECORD,
  delete_many: ProposalActionType.DELETE_RECORDS,
};

const STATIC_TOOL_ID_TO_ACTION_TYPE: Record<string, ProposalActionType> = {
  send_email: ProposalActionType.SEND_EMAIL,
  create_calendar_event: ProposalActionType.CREATE_CALENDAR_EVENT,
};

// A delete carries no proposed field values, so `updatedAt` stands in as the
// staleness witness: any human edit between proposal and approval moves it.
const DELETE_BASELINE_FIELD_NAMES = ['updatedAt'];

@Injectable()
export class ProposalGateService {
  private readonly logger = new Logger(ProposalGateService.name);

  constructor(
    private readonly aiWritePolicyService: AiWritePolicyService,
    private readonly findRecordsService: FindRecordsService,
    private readonly factService: FactService,
    private readonly proposalSupersessionService: ProposalSupersessionService,
    private readonly notificationService: NotificationService,
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

    const gateInput = this.buildGateInput(descriptor, args);

    if (!isDefined(gateInput)) {
      return { kind: 'ALLOW' };
    }

    // Fail-closed in a way that can actually resolve: a CRUD operation this
    // gate cannot classify is refused outright rather than turned into a
    // proposal item nothing can ever apply. See the `unclassified` field.
    if (gateInput.unclassified === true) {
      return {
        kind: 'FORBID',
        failure: buildToolFailure({
          code: 'UNSUPPORTED_OPERATION',
          message: `"${descriptor.name}" is not a recognized database operation and cannot be proposed for approval.`,
          hint: 'This is a bug in the tool definition, not a policy setting — report it rather than retrying.',
          retryable: false,
          allowedActions: [],
        }),
      };
    }

    const policy = await this.aiWritePolicyService.getPolicy(
      context.workspaceId,
    );
    const mode = this.aiWritePolicyService.resolveMode(
      policy,
      gateInput.target,
    );

    if (mode === 'AUTO') {
      // PROPOSE-mode deletes already stop at human review; this second call is
      // the only thing standing between an AUTO policy and a one-shot delete.
      // I17: DELETE_RECORDS as well as DELETE_RECORD — an AUTO-policy bulk
      // delete is the exact case this exists for.
      const isDeleteAction =
        gateInput.actionType === ProposalActionType.DELETE_RECORD ||
        gateInput.actionType === ProposalActionType.DELETE_RECORDS;

      // M3: a delete whose basis could not be derived (a missing or non-string
      // id, an absent filter) used to fall past the confirmation branch and
      // return ALLOW, so a malformed call was silently exempted from the one
      // control that applies to it. Refuse it instead of ungating it.
      if (isDeleteAction && !isDefined(gateInput.confirmationBasis)) {
        return {
          kind: 'FORBID',
          failure: buildToolFailure({
            code: 'INVALID_ARGUMENTS',
            message: `This ${gateInput.objectNameSingular} delete does not identify what it would delete.`,
            hint: 'Reissue the call with a string "id" for delete_one, or a non-empty "filter" for delete_many.',
            retryable: true,
            allowedActions: ['retry'],
          }),
        };
      }

      if (isDeleteAction && isDefined(gateInput.confirmationBasis)) {
        const expectedToken = buildDeleteConfirmationToken({
          workspaceId: context.workspaceId,
          objectNameSingular: gateInput.objectNameSingular ?? '',
          basis: gateInput.confirmationBasis,
        });

        if (gateInput.confirm !== expectedToken) {
          return {
            kind: 'CONFIRMATION_REQUIRED',
            failure: buildToolFailure({
              code: 'CONFIRMATION_REQUIRED',
              message:
                gateInput.actionType === ProposalActionType.DELETE_RECORDS
                  ? `Deleting ${gateInput.objectNameSingular} records matching this filter is irreversible from this tool.`
                  : `Deleting this ${gateInput.objectNameSingular} record is irreversible from this tool.`,
              hint: `Confirm with the user, then repeat this exact call with confirm: "${expectedToken}".`,
              retryable: true,
              allowedActions: ['retry_with_confirm_token'],
            }),
          };
        }
      }

      return { kind: 'ALLOW' };
    }

    if (mode === 'FORBID') {
      return {
        kind: 'FORBID',
        failure: buildToolFailure({
          code: 'FORBIDDEN_BY_POLICY',
          message: `This workspace does not permit AI to perform "${descriptor.name}".`,
          hint: 'Ask a workspace admin to change the AI write policy for this object or tool, or ask a human to make this change directly.',
          retryable: false,
          allowedActions: ['ask_admin_to_change_policy'],
        }),
      };
    }

    const proposal = await this.getOrCreatePendingProposal(context);

    const existingItem = await this.findDuplicatePendingItem({
      proposalId: proposal.id,
      actionType: gateInput.actionType,
      objectNameSingular: gateInput.objectNameSingular,
      recordId: gateInput.recordId,
      payload: gateInput.payload,
    });

    if (isDefined(existingItem)) {
      return {
        kind: 'PROPOSED',
        output: {
          success: true,
          message:
            'This exact change is already awaiting human approval from an earlier call in this turn. Do not retry.',
          result: {
            proposalId: proposal.id,
            proposalItemId: existingItem.id,
            status: existingItem.status,
          },
        },
      };
    }

    const { baseline, visible } = await this.readBaseline({
      objectNameSingular: gateInput.objectNameSingular,
      recordId: gateInput.recordId,
      fieldNames: gateInput.baselineFieldNames,
      context,
    });

    // An agent must not be able to launder a write to a row it cannot read
    // through the approval queue. FORBID, not PROPOSE: a reviewer shown a
    // change to a record the agent never saw has no way to judge it.
    if (!visible && isDefined(gateInput.recordId)) {
      return {
        kind: 'FORBID',
        failure: buildToolFailure({
          code: 'FORBIDDEN_BY_POLICY',
          message: `You cannot propose a change to ${gateInput.objectNameSingular} ${gateInput.recordId} because you cannot read that record.`,
          hint: 'Your role does not grant you access to this record. Ask an administrator to widen your record scope rather than retrying.',
          retryable: false,
          allowedActions: [],
        }),
      };
    }

    // The facts standing for these fields right now. This is a read: it
    // attaches justification to an item the gate was already creating, and
    // opens no second write path. Static-tool items pass null object/record,
    // so this resolves to [] — an outbound send carries no fact-backed
    // justification, which is the honest answer rather than a fabricated one.
    // Only a record-targeted write can have facts standing behind it. Passing
    // '' for a missing recordId reaches a uuid column and throws, which turned
    // every create_one and every gated static tool into an INTERNAL_ERROR.
    const factIds =
      isDefined(gateInput.objectNameSingular) && isDefined(gateInput.recordId)
        ? await this.factService.findCurrentFactIdsForFields({
            workspaceId: context.workspaceId,
            objectNameSingular: gateInput.objectNameSingular,
            recordId: gateInput.recordId,
            fieldNames: Object.keys(gateInput.payload),
          })
        : [];

    const item = await this.proposalItemRepository.save({
      proposalId: proposal.id,
      actionType: gateInput.actionType,
      objectNameSingular: gateInput.objectNameSingular,
      recordId: gateInput.recordId,
      toolId: gateInput.toolId,
      toolCategory: gateInput.toolCategory,
      payload: gateInput.payload,
      baseline,
      factIds,
      status: ProposalItemStatus.PENDING,
    });

    // Retire older pending drafts for the same record+field in OTHER
    // proposals. Items inside this same batch are untouched — one turn's
    // items are one decision, not competing ones.
    await this.proposalSupersessionService.supersedeOverlappingItems({
      workspaceId: context.workspaceId,
      proposalId: proposal.id,
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
    descriptor: ToolIndexEntry | ToolDescriptor,
    args: Record<string, unknown>,
  ): GateInput | null {
    const { executionRef } = descriptor;

    if (executionRef.kind === 'database_crud') {
      const isUngatedRead = UNGATED_CRUD_OPERATIONS.some(
        (operation) => operation === executionRef.operation,
      );

      if (isUngatedRead) {
        return null;
      }

      return this.buildCrudGateInput(
        executionRef.operation,
        executionRef.objectNameSingular,
        args,
      );
    }

    if (executionRef.kind === 'static') {
      const { toolId } = executionRef;

      if (!this.isGatedStaticTool(toolId, args)) {
        return null;
      }

      return {
        target: { kind: 'tool', toolId },
        actionType:
          STATIC_TOOL_ID_TO_ACTION_TYPE[toolId] ??
          ProposalActionType.STATIC_TOOL,
        objectNameSingular: null,
        recordId: null,
        toolId,
        toolCategory: descriptor.category,
        payload: args,
        baselineFieldNames: [],
      };
    }

    return null;
  }

  private isGatedStaticTool(
    toolId: string,
    args: Record<string, unknown>,
  ): boolean {
    if (UNGATED_STATIC_TOOL_IDS.some((ungatedId) => ungatedId === toolId)) {
      return false;
    }

    if (toolId === 'http_request') {
      const method =
        typeof args.method === 'string' ? args.method.toUpperCase() : 'GET';

      return !UNGATED_HTTP_METHODS.some((readMethod) => readMethod === method);
    }

    return true;
  }

  // The replay payload is the untouched call envelope. Policy keys are a
  // separate projection — conflating the two is what silently merged a
  // create_many batch into one record.
  private buildCrudGateInput(
    operation: string,
    objectNameSingular: string,
    args: Record<string, unknown>,
  ): GateInput {
    const actionType = CRUD_OPERATION_TO_ACTION_TYPE[operation];
    const base = {
      actionType,
      objectNameSingular,
      toolId: null,
      toolCategory: null,
    };

    if (operation === 'update_one') {
      const { id, ...fields } = args;
      const payload = Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== undefined),
      );
      const fieldNames = Object.keys(payload);

      return {
        ...base,
        target: { kind: 'record', objectNameSingular, fieldNames },
        recordId: typeof id === 'string' ? id : null,
        payload,
        baselineFieldNames: fieldNames,
      };
    }

    if (operation === 'delete_one') {
      const { id, confirm } = args;

      return {
        ...base,
        target: { kind: 'record', objectNameSingular, fieldNames: [] },
        recordId: typeof id === 'string' ? id : null,
        payload: {},
        baselineFieldNames: DELETE_BASELINE_FIELD_NAMES,
        confirm: typeof confirm === 'string' ? confirm : null,
        confirmationBasis: typeof id === 'string' ? id : null,
      };
    }

    if (operation === 'create_one') {
      const fieldNames = Object.keys(args).filter(
        (fieldName) => fieldName !== 'id',
      );

      return {
        ...base,
        target: { kind: 'record', objectNameSingular, fieldNames },
        recordId: null,
        payload: args,
        baselineFieldNames: [],
      };
    }

    if (operation === 'create_many' || operation === 'upsert_many') {
      const records = Array.isArray(args.records) ? args.records : [];
      // Union of every record's fields, so one risky field anywhere in the
      // batch still resolves the policy for the whole write.
      const fieldNames = [
        ...new Set(
          records.flatMap((record) =>
            typeof record === 'object' && record !== null
              ? Object.keys(record as Record<string, unknown>)
              : [],
          ),
        ),
      ].filter((fieldName) => fieldName !== 'id');

      return {
        ...base,
        target: { kind: 'record', objectNameSingular, fieldNames },
        recordId: null,
        payload: { records },
        baselineFieldNames: [],
      };
    }

    if (operation === 'update_many') {
      const data =
        typeof args.data === 'object' && args.data !== null
          ? (args.data as Record<string, unknown>)
          : {};

      return {
        ...base,
        target: {
          kind: 'record',
          objectNameSingular,
          fieldNames: Object.keys(data),
        },
        recordId: null,
        payload: { filter: args.filter ?? {}, data },
        baselineFieldNames: [],
      };
    }

    if (operation === 'delete_many') {
      const filter = args.filter ?? {};

      return {
        ...base,
        target: { kind: 'record', objectNameSingular, fieldNames: [] },
        recordId: null,
        payload: { filter },
        baselineFieldNames: [],
        confirm: typeof args.confirm === 'string' ? args.confirm : null,
        // Stringified filter, so two different filters get two different
        // tokens and a confirmed narrow delete cannot be widened on the
        // second call.
        confirmationBasis: buildDeleteFilterBasis(filter),
      };
    }

    // An operation nobody classified. Marked unclassified rather than turned
    // into an approvable proposal item — see the `unclassified` field and its
    // evaluate() check.
    return {
      ...base,
      actionType: actionType ?? ProposalActionType.STATIC_TOOL,
      target: { kind: 'record', objectNameSingular, fieldNames: [] },
      recordId: typeof args.id === 'string' ? args.id : null,
      payload: args,
      baselineFieldNames: [],
      unclassified: true,
    };
  }

  // Reads the fields the write would change, so approval can detect that a
  // human edited them in the meantime. Uses the agent's own role config *and*
  // its own auth context: the role config carries field permissions, but
  // record scope is enforced against the principal, and a principal only
  // comes from the auth context.
  //
  // Returns `visible` separately from `baseline`. Collapsing "I read nothing"
  // into `{}` is what hid the bug: hasBaselineConflict short-circuits to false
  // on an empty baseline, so every proposal against a row the agent could not
  // read silently had conflict detection turned off.
  private async readBaseline(params: {
    objectNameSingular: string | null;
    recordId: string | null;
    fieldNames: string[];
    context: ToolProviderContext;
  }): Promise<{ baseline: Record<string, unknown>; visible: boolean }> {
    const { objectNameSingular, recordId, fieldNames, context } = params;

    // No record to read means nothing to be scoped out of - a create, an
    // outbound send, a static tool. Visible by definition.
    if (
      !isDefined(objectNameSingular) ||
      !isDefined(recordId) ||
      fieldNames.length === 0
    ) {
      return { baseline: {}, visible: true };
    }

    const output = await this.findRecordsService.execute({
      objectName: objectNameSingular,
      filter: { id: { eq: recordId } },
      limit: 1,
      select: fieldNames,
      shouldBuildEffectiveSelectFields: true,
      // Falls back to a system context only for callers that carry no
      // principal at all (crons, jobs). Those already run unscoped everywhere
      // else, so this neither widens nor narrows them.
      authContext:
        context.authContext ?? buildSystemAuthContext(context.workspaceId),
      rolePermissionConfig: context.rolePermissionConfig,
    });

    if (!output.success) {
      // Load-bearing now: a failed read means the gate cannot tell whether the
      // agent may see this row, and the safe reading of that is "it may not".
      this.logger.warn(
        `Could not read baseline for ${objectNameSingular}:${recordId} — ${output.error}`,
      );

      return { baseline: {}, visible: false };
    }

    const records = (output.result as { records?: Record<string, unknown>[] })
      ?.records;
    const record = records?.[0];

    if (!isDefined(record)) {
      return { baseline: {}, visible: false };
    }

    return {
      baseline: Object.fromEntries(
        fieldNames.map((fieldName) => [fieldName, record[fieldName]]),
      ),
      visible: true,
    };
  }

  // A retried tool call inside the same turn must not create a second
  // reviewable item for the same intended change. Deep-equal payload is
  // enough here because the batch is already scoped to one proposal.
  private async findDuplicatePendingItem(params: {
    proposalId: string;
    actionType: ProposalActionType;
    objectNameSingular: string | null;
    recordId: string | null;
    payload: Record<string, unknown>;
  }): Promise<ProposalItemEntity | undefined> {
    const items = await this.proposalItemRepository.find({
      where: {
        proposalId: params.proposalId,
        status: ProposalItemStatus.PENDING,
      },
    });

    return items.find(
      (item) =>
        item.actionType === params.actionType &&
        item.objectNameSingular === params.objectNameSingular &&
        item.recordId === params.recordId &&
        JSON.stringify(item.payload) === JSON.stringify(params.payload),
    );
  }

  // Making the pending proposal visible must never be able to fail the write
  // that produced it: the proposal is already safely captured, and losing the
  // bell is strictly better than losing the draft. Deduped on proposal id, so
  // the joined-batch path raising it a second time is a no-op.
  private async notifyProposalWaiting(
    workspaceId: string,
    proposalId: string,
  ): Promise<void> {
    try {
      await this.notificationService.raise(
        buildProposalNotification({ workspaceId, proposalId }),
      );
    } catch (error) {
      this.logger.warn(
        `Failed to raise proposal notification for ${proposalId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // One agent turn produces one reviewable batch rather than one proposal per
  // tool call. Falls back to a fresh proposal when there is no thread to key on.
  //
  // find-then-save is not atomic: two tool calls in the same turn (concurrent
  // dispatch, or a retry racing the original) can both miss the find() below.
  // IDX_PROPOSAL_THREAD_PENDING_UNIQUE settles the race in the database — a
  // unique violation here means the concurrent caller already created the
  // PENDING proposal for this thread, so this call re-reads and joins it
  // instead of creating a second one.
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

    try {
      const created = await this.proposalRepository.save({
        workspaceId: context.workspaceId,
        threadId: context.threadId ?? null,
        createdByActor: context.actorContext ?? null,
        status: ProposalStatus.PENDING,
        expiresAt,
      });

      await this.notifyProposalWaiting(context.workspaceId, created.id);

      return created;
    } catch (error) {
      if (!isPostgresUniqueViolation(error) || !isDefined(context.threadId)) {
        throw error;
      }

      const winner = await this.proposalRepository.findOne({
        where: {
          workspaceId: context.workspaceId,
          threadId: context.threadId,
          status: ProposalStatus.PENDING,
        },
      });

      if (!isDefined(winner)) {
        // The row that won the race is gone by the time we re-read (approved,
        // rejected, or expired in the interim) — surface the original error
        // rather than silently fabricate a proposal.
        throw error;
      }

      return winner;
    }
  }
}
