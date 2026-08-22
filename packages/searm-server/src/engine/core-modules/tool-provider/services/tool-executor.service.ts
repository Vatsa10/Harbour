import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { type AggregateOperations } from 'searm-shared/types';
import { isDefined } from 'searm-shared/utils';
import { Repository } from 'typeorm';

import { type ObjectRecordGroupBy } from 'src/engine/api/graphql/workspace-query-builder/interfaces/object-record.interface';

import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { fromUserEntityToFlat } from 'src/engine/core-modules/user/utils/from-user-entity-to-flat.util';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';

import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { buildUserAuthContext } from 'src/engine/core-modules/auth/utils/build-user-auth-context.util';
import { LogicFunctionExecutorService } from 'src/engine/core-modules/logic-function/logic-function-executor/logic-function-executor.service';
import { CreateManyRecordsService } from 'src/engine/core-modules/record-crud/services/create-many-records.service';
import { CreateRecordService } from 'src/engine/core-modules/record-crud/services/create-record.service';
import { DeleteManyRecordsService } from 'src/engine/core-modules/record-crud/services/delete-many-records.service';
import { DeleteRecordService } from 'src/engine/core-modules/record-crud/services/delete-record.service';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { GroupByRecordsService } from 'src/engine/core-modules/record-crud/services/group-by-records.service';
import { UpdateManyRecordsService } from 'src/engine/core-modules/record-crud/services/update-many-records.service';
import { UpdateRecordService } from 'src/engine/core-modules/record-crud/services/update-record.service';
import { UpsertManyRecordsService } from 'src/engine/core-modules/record-crud/services/upsert-many-records.service';
import { type FindRecordsParams } from 'src/engine/core-modules/record-crud/types/find-records-params.type';
import { TOOL_PROVIDERS } from 'src/engine/core-modules/tool-provider/constants/tool-providers.token';
import { DatabaseToolProvider } from 'src/engine/core-modules/tool-provider/providers/database-tool.provider';
import { type ToolProvider } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider.interface';
import { type ToolDescriptor } from 'src/engine/core-modules/tool-provider/types/tool-descriptor.type';
import { type ToolExecutionRef } from 'src/engine/core-modules/tool-provider/types/tool-execution-ref.type';
import { type ToolIndexEntry } from 'src/engine/core-modules/tool-provider/types/tool-index-entry.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import {
  buildToolFailure,
  toFailedToolOutput,
} from 'src/engine/core-modules/tool/utils/build-tool-failure.util';
import { ensureToolFailureEnvelope } from 'src/engine/core-modules/tool/utils/ensure-tool-failure-envelope.util';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { ProposalGateService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

@Injectable()
export class ToolExecutorService {
  private readonly logger = new Logger(ToolExecutorService.name);

  constructor(
    @Inject(TOOL_PROVIDERS)
    private readonly providers: ToolProvider[],
    private readonly findRecordsService: FindRecordsService,
    private readonly groupByRecordsService: GroupByRecordsService,
    private readonly createRecordService: CreateRecordService,
    private readonly createManyRecordsService: CreateManyRecordsService,
    private readonly updateRecordService: UpdateRecordService,
    private readonly updateManyRecordsService: UpdateManyRecordsService,
    private readonly upsertManyRecordsService: UpsertManyRecordsService,
    private readonly deleteRecordService: DeleteRecordService,
    private readonly deleteManyRecordsService: DeleteManyRecordsService,
    private readonly logicFunctionExecutorService: LogicFunctionExecutorService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly proposalGateService: ProposalGateService,
  ) {}

  async dispatch(
    descriptor: ToolIndexEntry | ToolDescriptor,
    args: Record<string, unknown> | undefined,
    context: ToolProviderContext,
  ): Promise<ToolOutput> {
    const safeArgs = args ?? {};

    // Every AI write in the product funnels through here, so the approval gate
    // sits above the tool layer — a new write tool is gated by default.
    const decision = await this.proposalGateService.evaluate({
      descriptor,
      args: safeArgs,
      context,
    });

    if (decision.kind === 'PROPOSED') {
      return decision.output;
    }

    if (decision.kind === 'FORBID') {
      return toFailedToolOutput(decision.failure);
    }

    // Without this branch an AUTO-policy delete missing its confirmation token
    // falls through to the switch and deletes the record anyway, which makes
    // the whole confirmation gate unenforced.
    if (decision.kind === 'CONFIRMATION_REQUIRED') {
      return toFailedToolOutput(decision.failure);
    }

    // The record-crud services and the static providers still report failure
    // as a bare English string. That is the exact class of failure the
    // envelope exists to fix, so classify it on the way out rather than
    // leaving the agent to parse prose.
    return ensureToolFailureEnvelope(
      await this.dispatchToExecutor(descriptor, safeArgs, context),
    );
  }

  private async dispatchToExecutor(
    descriptor: ToolIndexEntry | ToolDescriptor,
    safeArgs: Record<string, unknown>,
    context: ToolProviderContext,
  ): Promise<ToolOutput> {
    switch (descriptor.executionRef.kind) {
      case 'database_crud':
        return this.dispatchDatabaseCrud(
          descriptor.executionRef,
          safeArgs,
          context,
        );
      case 'static':
        return this.dispatchStaticTool(descriptor, safeArgs, context);
      case 'logic_function':
        return this.dispatchLogicFunction(
          descriptor.executionRef,
          safeArgs,
          context,
        );
    }
  }

  private async dispatchDatabaseCrud(
    ref: Extract<ToolExecutionRef, { kind: 'database_crud' }>,
    args: Record<string, unknown>,
    context: ToolProviderContext,
  ): Promise<ToolOutput> {
    // I5: the catalog decides what a role may write from its explicit grants,
    // while record-crud enforcement reads the composed cache with its isSystem
    // full-CRUD fallback. Re-check the catalog's rule here so a descriptor that
    // reached dispatch by any other route is still refused.
    const databaseProvider = this.providers.find(
      (provider): provider is DatabaseToolProvider =>
        provider instanceof DatabaseToolProvider,
    );

    if (
      isDefined(databaseProvider) &&
      !(await databaseProvider.isCrudOperationPermitted({
        objectNameSingular: ref.objectNameSingular,
        operation: ref.operation,
        context,
      }))
    ) {
      return toFailedToolOutput(
        buildToolFailure({
          code: 'PERMISSION_DENIED',
          message: `Your role may not perform "${ref.operation}" on ${ref.objectNameSingular}.`,
          hint: 'Ask a human with the right permissions to make this change, or call get_tool_catalog to see what you may do.',
          retryable: false,
          allowedActions: ['get_tool_catalog'],
        }),
      );
    }

    const authContext =
      context.authContext ?? (await this.buildAuthContext(context));

    switch (ref.operation) {
      case 'find_many': {
        const { limit, offset, orderBy, select, ...filter } = args;

        return this.findRecordsService.execute({
          objectName: ref.objectNameSingular,
          filter,
          orderBy: orderBy as FindRecordsParams['orderBy'],
          limit: limit as number | undefined,
          offset: offset as number | undefined,
          select: select as string[],
          shouldBuildEffectiveSelectFields: true,
          authContext,
          rolePermissionConfig: context.rolePermissionConfig,
        });
      }

      case 'find_one': {
        const { select, id } = args;

        return this.findRecordsService.execute({
          objectName: ref.objectNameSingular,
          filter: { id: { eq: id } },
          limit: 1,
          select: select as string[],
          shouldBuildEffectiveSelectFields: isDefined(select),
          authContext,
          rolePermissionConfig: context.rolePermissionConfig,
        });
      }

      case 'create_one':
        return this.createRecordService.execute({
          objectName: ref.objectNameSingular,
          objectRecord: args,
          authContext,
          rolePermissionConfig: context.rolePermissionConfig,
          createdBy: context.actorContext,
          slimResponse: true,
        });

      case 'create_many':
        return this.createManyRecordsService.execute({
          objectName: ref.objectNameSingular,
          objectRecords: args.records as Record<string, unknown>[],
          authContext,
          rolePermissionConfig: context.rolePermissionConfig,
          createdBy: context.actorContext,
          slimResponse: true,
        });

      case 'update_one': {
        const { id, ...fields } = args;
        const objectRecord = Object.fromEntries(
          Object.entries(fields).filter(([, value]) => value !== undefined),
        );

        return this.updateRecordService.execute({
          objectName: ref.objectNameSingular,
          objectRecordId: id as string,
          objectRecord,
          authContext,
          rolePermissionConfig: context.rolePermissionConfig,
          slimResponse: true,
        });
      }

      case 'update_many':
        return this.updateManyRecordsService.execute({
          objectName: ref.objectNameSingular,
          filter: args.filter as Record<string, unknown>,
          data: args.data as Record<string, unknown>,
          authContext,
          rolePermissionConfig: context.rolePermissionConfig,
          slimResponse: true,
        });

      case 'upsert_many':
        return this.upsertManyRecordsService.execute({
          objectName: ref.objectNameSingular,
          objectRecords: args.records as Record<string, unknown>[],
          authContext,
          rolePermissionConfig: context.rolePermissionConfig,
          createdBy: context.actorContext,
          slimResponse: true,
        });

      case 'delete_one':
        return this.deleteRecordService.execute({
          objectName: ref.objectNameSingular,
          objectRecordId: args.id as string,
          authContext,
          rolePermissionConfig: context.rolePermissionConfig,
          soft: true,
        });

      case 'delete_many':
        return this.deleteManyRecordsService.execute({
          objectName: ref.objectNameSingular,
          filter: args.filter as Record<string, unknown>,
          authContext,
          rolePermissionConfig: context.rolePermissionConfig,
        });

      case 'group_by': {
        const {
          groupBy,
          aggregateOperation,
          aggregateFieldName,
          limit: groupByLimit,
          orderBy: groupByOrderBy,
          ...groupByFilter
        } = args;

        return this.groupByRecordsService.execute({
          objectName: ref.objectNameSingular,
          groupBy: groupBy as ObjectRecordGroupBy,
          aggregateOperation: aggregateOperation as
            | keyof typeof AggregateOperations
            | undefined,
          aggregateFieldName: aggregateFieldName as string | undefined,
          limit: groupByLimit as number | undefined,
          orderBy: groupByOrderBy as 'ASC' | 'DESC' | undefined,
          filter: groupByFilter,
          authContext,
          rolePermissionConfig: context.rolePermissionConfig,
        });
      }
    }
  }

  private async dispatchStaticTool(
    descriptor: ToolIndexEntry | ToolDescriptor,
    args: Record<string, unknown>,
    context: ToolProviderContext,
  ): Promise<ToolOutput> {
    if (descriptor.executionRef.kind !== 'static') {
      throw new Error('Expected static executionRef');
    }

    const provider = this.providers.find(
      (candidate) => candidate.category === descriptor.category,
    );

    if (!provider) {
      throw new Error(
        `No provider registered for category "${descriptor.category}" (tool: ${descriptor.executionRef.toolId})`,
      );
    }

    // Defense-in-depth: catalog and by-name lookups already filter by
    // `isAvailable`, but re-verify at dispatch so the gate is enforced in
    // one place regardless of how the descriptor reached us.
    if (!(await provider.isAvailable(context))) {
      return toFailedToolOutput(
        buildToolFailure({
          code: 'PERMISSION_DENIED',
          message: `Tool "${descriptor.name}" is not available in this context.`,
          hint: 'Use get_tool_catalog to see the tools you may call here.',
          retryable: false,
          allowedActions: ['get_tool_catalog'],
        }),
      );
    }

    return provider.executeStaticTool(
      descriptor.executionRef.toolId,
      args,
      context,
    );
  }

  private async dispatchLogicFunction(
    ref: Extract<ToolExecutionRef, { kind: 'logic_function' }>,
    args: Record<string, unknown>,
    context: ToolProviderContext,
  ): Promise<ToolOutput> {
    const result = await this.logicFunctionExecutorService.execute({
      logicFunctionId: ref.logicFunctionId,
      workspaceId: context.workspaceId,
      payload: args,
    });

    if (result.error) {
      return toFailedToolOutput(
        buildToolFailure({
          code: 'INTERNAL_ERROR',
          message: `Logic function execution failed: ${result.error.errorMessage}`,
          // A logic function failure is usually the arguments or a transient
          // runtime fault, so one informed retry is legitimate here.
          hint: 'Check the arguments against the tool schema and try once more; if it fails again, report the error to the user.',
          retryable: true,
        }),
      );
    }

    return {
      success: true,
      message: 'Logic function executed successfully',
      result: result.data ?? undefined,
    };
  }

  // Build authContext on demand for database CRUD operations
  private async buildAuthContext(
    context: ToolProviderContext,
  ): Promise<WorkspaceAuthContext> {
    if (!isDefined(context.userId) || !isDefined(context.userWorkspaceId)) {
      throw new AuthException(
        'userId and userWorkspaceId are required for database operations',
        AuthExceptionCode.UNAUTHENTICATED,
      );
    }

    const user = await this.userRepository.findOne({
      where: { id: context.userId },
    });

    if (!isDefined(user)) {
      throw new AuthException(
        'User not found',
        AuthExceptionCode.UNAUTHENTICATED,
      );
    }

    const { flatWorkspaceMemberMaps } =
      await this.workspaceCacheService.getOrRecompute(context.workspaceId, [
        'flatWorkspaceMemberMaps',
      ]);

    const workspaceMemberId = flatWorkspaceMemberMaps.idByUserId[user.id];

    const workspaceMember = isDefined(workspaceMemberId)
      ? flatWorkspaceMemberMaps.byId[workspaceMemberId]
      : undefined;

    if (!isDefined(workspaceMemberId) || !isDefined(workspaceMember)) {
      throw new AuthException(
        'Workspace member not found',
        AuthExceptionCode.UNAUTHENTICATED,
      );
    }

    return buildUserAuthContext({
      workspace: { id: context.workspaceId } as FlatWorkspace,
      userWorkspaceId: context.userWorkspaceId,
      user: fromUserEntityToFlat(user),
      workspaceMemberId,
      workspaceMember,
    });
  }
}
