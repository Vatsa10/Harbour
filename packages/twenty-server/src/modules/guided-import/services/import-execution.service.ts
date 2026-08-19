import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { FieldActorSource, type ActorMetadata } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { type Repository } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { buildUserAuthContext } from 'src/engine/core-modules/auth/utils/build-user-auth-context.util';
import { CreateRecordService } from 'src/engine/core-modules/record-crud/services/create-record.service';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { UpdateRecordService } from 'src/engine/core-modules/record-crud/services/update-record.service';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { fromUserEntityToFlat } from 'src/engine/core-modules/user/utils/from-user-entity-to-flat.util';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { ProposalCreationService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-creation.service';
import { ProposalActionType } from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';
import { UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { type RolePermissionConfig } from 'src/engine/twenty-orm/types/role-permission-config';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import {
  ImportBatchStatus,
  ImportRowMatchAction,
  ImportRowStatus,
} from 'src/modules/guided-import/types/import-batch-status.type';
import { computeImportIdentityKey } from 'src/modules/guided-import/utils/compute-import-identity-key.util';

// C7: the same shape ProposalExecutionService.buildApproverContext produces.
// authContext carries the real user so every write is attributed to them and
// not to SYSTEM; rolePermissionConfig enforces their real permissions.
type ImportActorContext = {
  authContext: WorkspaceAuthContext;
  rolePermissionConfig: RolePermissionConfig;
  actorMetadata: ActorMetadata;
};

type RowOutcome = {
  kind: 'created' | 'updated' | 'proposed' | 'skipped';
  recordId?: string;
};

// Rows are claimed in chunks rather than all at once: a 100k-row file must not
// be held in memory, and each chunk boundary is a natural resume point.
const IMPORT_ROW_CHUNK_SIZE = 100;

// How long a claimed row stays claimed before another run may take it back.
// Long enough that a slow chunk is never stolen mid-flight, short enough that
// a worker killed mid-chunk does not strand its rows for an operator to
// unpick by hand.
const IMPORT_ROW_LEASE_MINUTES = 15;

@Injectable()
export class ImportExecutionService {
  private readonly logger = new Logger(ImportExecutionService.name);

  constructor(
    private readonly createRecordService: CreateRecordService,
    private readonly updateRecordService: UpdateRecordService,
    private readonly findRecordsService: FindRecordsService,
    private readonly proposalCreationService: ProposalCreationService,
    private readonly userRoleService: UserRoleService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    // Core-schema platform tables, not workspace-object data, so the scoped
    // repository wrapper does not apply.
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(ImportBatchEntity)
    private readonly importBatchRepository: Repository<ImportBatchEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(ImportRowEntity)
    private readonly importRowRepository: Repository<ImportRowEntity>,
  ) {}

  // Only unclaimed rows are ever fetched — a row already PROCESSED or FAILED
  // from an earlier, crashed run of this same job is never touched again.
  // Claiming is a single atomic UPDATE ... FOR UPDATE SKIP LOCKED, so two
  // concurrent executions of the same batch take disjoint chunks instead of
  // both processing (and double-writing) the same rows.
  async executeBatch(params: {
    workspaceId: string;
    importBatchId: string;
  }): Promise<void> {
    const { workspaceId, importBatchId } = params;

    const batch = await this.importBatchRepository.findOne({
      where: { id: importBatchId, workspaceId },
    });

    if (!isDefined(batch)) {
      return;
    }

    // C7: resolve the importing user's own role and identity once per batch —
    // every row's write carries it, so permission enforcement and audit
    // attribution both name the human who uploaded the file, not SYSTEM.
    const importer = await this.buildImportActorContext(
      workspaceId,
      batch.createdByUserWorkspaceId,
    );

    // Intra-import dedup: normalised identity value -> id of the record this
    // same import already created for it. Match resolution ran before the
    // import started, so it could only see pre-existing records; without this
    // map a CSV naming the same new company on two rows creates it twice.
    const createdRecordIdByIdentityKey = new Map<string, string>();

    let createdRowCount = batch.createdRowCount;
    let updatedRowCount = batch.updatedRowCount;
    let proposedRowCount = batch.proposedRowCount;
    let skippedRowCount = batch.skippedRowCount;
    let failedRowCount = batch.failedRowCount;

    // Re-querying PENDING each pass is what makes the loop terminate: every
    // row processed above leaves PENDING, so the next take() returns the next
    // slice. A row that somehow stayed PENDING would loop forever, so the
    // loop also breaks when a chunk yields no state change.
    for (;;) {
      const rows = await this.claimRowChunk(importBatchId);

      if (rows.length === 0) {
        break;
      }

      let progressed = false;

      for (const row of rows) {
        try {
          const outcome = await this.processRow(
            workspaceId,
            batch.objectNameSingular,
            importBatchId,
            row,
            importer,
            createdRecordIdByIdentityKey,
          );

          // Persist this row's outcome before moving to the next row, so a
          // crash between two rows leaves the earlier one durably PROCESSED —
          // never re-run on retry.
          await this.importRowRepository.save({
            ...row,
            status: ImportRowStatus.PROCESSED,
            matchedRecordId: outcome.recordId ?? row.matchedRecordId,
            processedAt: new Date(),
          });

          if (outcome.kind === 'created') createdRowCount += 1;
          if (outcome.kind === 'updated') updatedRowCount += 1;
          if (outcome.kind === 'proposed') proposedRowCount += 1;
          if (outcome.kind === 'skipped') skippedRowCount += 1;
        } catch (error) {
          failedRowCount += 1;
          await this.importRowRepository.save({
            ...row,
            status: ImportRowStatus.FAILED,
            errorMessage: error instanceof Error ? error.message : String(error),
            processedAt: new Date(),
          });
          this.logger.warn(
            `Import row ${row.id} (batch ${importBatchId}) failed: ${error}`,
          );
        }

        progressed = true;
      }

      if (!progressed) {
        break;
      }
    }

    const remainingPending = await this.importRowRepository.count({
      where: [
        { importBatchId, status: ImportRowStatus.PENDING },
        { importBatchId, status: ImportRowStatus.IN_PROGRESS },
      ],
    });

    await this.importBatchRepository.save({
      ...batch,
      createdRowCount,
      updatedRowCount,
      proposedRowCount,
      skippedRowCount,
      failedRowCount,
      processedRows: batch.totalRows - remainingPending,
      status:
        remainingPending === 0
          ? ImportBatchStatus.COMPLETED
          : ImportBatchStatus.RUNNING,
    });
  }

  // Claims the next chunk atomically. A row is claimable when it is still
  // PENDING, or when it was claimed by a worker that then died and its lease
  // has expired. SKIP LOCKED lets a second worker take the following chunk
  // instead of blocking on this one.
  private async claimRowChunk(
    importBatchId: string,
  ): Promise<ImportRowEntity[]> {
    // TypeORM's PostgresQueryRunner.query() for UPDATE/DELETE ... RETURNING
    // returns a tuple [rows, rowCount], not a plain rows array — unlike a
    // plain SELECT. Destructuring the tuple here is load-bearing: treating
    // the tuple itself as the rows array makes rows.length always 2
    // regardless of how many rows were actually claimed, which breaks both
    // loop-termination checks in executeBatch.
    const [rows]: [ImportRowEntity[], number] =
      await this.importRowRepository.query(
        `UPDATE "core"."importRow" AS r
           SET "status" = $1, "leasedAt" = now()
         WHERE r."id" IN (
           SELECT c."id" FROM "core"."importRow" AS c
           WHERE c."importBatchId" = $2
             AND (
               c."status" = $3
               OR (
                 c."status" = $1
                 AND c."leasedAt" < now() - ($4 || ' minutes')::interval
               )
             )
           ORDER BY c."rowNumber" ASC
           LIMIT $5
           FOR UPDATE SKIP LOCKED
         )
         RETURNING r.*`,
        [
          ImportRowStatus.IN_PROGRESS,
          importBatchId,
          ImportRowStatus.PENDING,
          String(IMPORT_ROW_LEASE_MINUTES),
          IMPORT_ROW_CHUNK_SIZE,
        ],
      );

    return rows;
  }

  private async processRow(
    workspaceId: string,
    objectNameSingular: string,
    importBatchId: string,
    row: ImportRowEntity,
    importer: ImportActorContext,
    createdRecordIdByIdentityKey: Map<string, string>,
  ): Promise<RowOutcome> {
    if (row.matchAction === ImportRowMatchAction.SKIP) {
      return { kind: 'skipped' };
    }

    if (
      isDefined(row.validationErrors) &&
      Object.keys(row.validationErrors).length > 0
    ) {
      throw new Error(
        `Row failed validation: ${JSON.stringify(row.validationErrors)}`,
      );
    }

    const mappedData = row.mappedData ?? {};

    // C7: writes carry the importing user's own role and are attributed to
    // them as createdBy/updatedBy — the same shape ProposalExecutionService
    // .applyItem uses on approval. A user who cannot write a field the CSV
    // maps to now gets the same permission error a manual create would.
    const identityKey = computeImportIdentityKey(
      objectNameSingular,
      mappedData,
    );

    if (row.matchAction === ImportRowMatchAction.CREATE) {
      // An earlier row of this same import already created this entity:
      // promote the CREATE to an UPDATE against that new id rather than
      // creating a second record for it.
      const alreadyCreatedRecordId = isDefined(identityKey)
        ? createdRecordIdByIdentityKey.get(identityKey)
        : undefined;

      if (isDefined(alreadyCreatedRecordId)) {
        return this.updateRecord(
          objectNameSingular,
          alreadyCreatedRecordId,
          mappedData,
          importer,
        );
      }

      const output = await this.createRecordService.execute({
        objectName: objectNameSingular,
        objectRecord: mappedData,
        authContext: importer.authContext,
        rolePermissionConfig: importer.rolePermissionConfig,
        createdBy: importer.actorMetadata,
        slimResponse: true,
      });

      if (!output.success) {
        throw new Error(output.error ?? output.message);
      }

      const record = (output.result as { record?: { id: string } } | undefined)
        ?.record;

      if (isDefined(identityKey) && isDefined(record?.id)) {
        createdRecordIdByIdentityKey.set(identityKey, record.id);
      }

      return { kind: 'created', recordId: record?.id };
    }

    if (row.matchAction === ImportRowMatchAction.UPDATE) {
      if (!isDefined(row.matchedRecordId)) {
        throw new Error('UPDATE row has no matchedRecordId.');
      }

      return this.updateRecord(
        objectNameSingular,
        row.matchedRecordId,
        mappedData,
        importer,
      );
    }

    // PROPOSE: the row matched an existing record only by a CANDIDATE signal
    // — never write it directly. ProposalCreationService consults
    // AiWritePolicyService and is idempotent on sourceKey, so a retried job
    // cannot double-propose.
    if (!isDefined(row.matchedRecordId)) {
      throw new Error('PROPOSE row has no matchedRecordId.');
    }

    const baseline = await this.readBaseline(
      workspaceId,
      objectNameSingular,
      row.matchedRecordId,
      Object.keys(mappedData),
    );

    await this.proposalCreationService.createFromExtraction({
      workspaceId,
      sourceKey: `import:${importBatchId}:${row.rowNumber}`,
      reason: `Row ${row.rowNumber} of the import matched an existing ${objectNameSingular} by a candidate signal, not by a confirmed identity field. Review before merging.`,
      createdByActor: importer.actorMetadata,
      items: [
        {
          actionType: ProposalActionType.UPDATE_RECORD,
          objectNameSingular,
          recordId: row.matchedRecordId,
          payload: mappedData,
          baseline,
        },
      ],
    });

    return { kind: 'proposed', recordId: row.matchedRecordId };
  }

  private async updateRecord(
    objectNameSingular: string,
    recordId: string,
    mappedData: Record<string, unknown>,
    importer: ImportActorContext,
  ): Promise<RowOutcome> {
    const output = await this.updateRecordService.execute({
      objectName: objectNameSingular,
      objectRecordId: recordId,
      objectRecord: mappedData,
      authContext: importer.authContext,
      rolePermissionConfig: importer.rolePermissionConfig,
      updatedBy: importer.actorMetadata,
      slimResponse: true,
    });

    if (!output.success) {
      throw new Error(output.error ?? output.message);
    }

    return { kind: 'updated', recordId };
  }

  private async readBaseline(
    workspaceId: string,
    objectNameSingular: string,
    recordId: string,
    fieldNames: string[],
  ): Promise<Record<string, unknown>> {
    if (fieldNames.length === 0) {
      return {};
    }

    const output = await this.findRecordsService.execute({
      objectName: objectNameSingular,
      filter: { id: { eq: recordId } },
      limit: 1,
      select: fieldNames,
      shouldBuildEffectiveSelectFields: true,
      authContext: buildSystemAuthContext(workspaceId),
      // Reading the baseline is a state comparison, not an attributed write —
      // the same privileged read hasBaselineConflict performs at approval.
      rolePermissionConfig: { shouldBypassPermissionChecks: true },
    });

    if (!output.success) {
      return {};
    }

    const record = output.result?.records?.[0] as
      | Record<string, unknown>
      | undefined;

    if (!isDefined(record)) {
      return {};
    }

    return Object.fromEntries(fieldNames.map((name) => [name, record[name]]));
  }

  // Same shape and same lookups as ProposalExecutionService
  // .buildApproverContext — duplicated rather than imported because that
  // method is private and its owning service is a different bounded context.
  private async buildImportActorContext(
    workspaceId: string,
    createdByUserWorkspaceId: string | null,
  ): Promise<ImportActorContext> {
    if (!isDefined(createdByUserWorkspaceId)) {
      // A batch with no recorded uploader cannot be safely attributed or
      // permission-checked — refuse rather than silently falling back to a
      // bypass context, which is exactly the C7 bug this fix removes.
      throw new Error(
        'ImportBatch has no createdByUserWorkspaceId; cannot execute without an importing user.',
      );
    }

    const userWorkspace = await this.userWorkspaceRepository.findOne({
      where: { id: createdByUserWorkspaceId, workspaceId },
    });

    if (!isDefined(userWorkspace)) {
      throw new Error(
        `Importing user workspace ${createdByUserWorkspaceId} not found`,
      );
    }

    const user = await this.userRepository.findOne({
      where: { id: userWorkspace.userId },
    });

    if (!isDefined(user)) {
      throw new Error(`Importing user ${userWorkspace.userId} not found`);
    }

    const { flatWorkspaceMemberMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatWorkspaceMemberMaps',
      ]);

    const workspaceMemberId = flatWorkspaceMemberMaps.idByUserId[user.id];
    const workspaceMember = isDefined(workspaceMemberId)
      ? flatWorkspaceMemberMaps.byId[workspaceMemberId]
      : undefined;

    if (!isDefined(workspaceMemberId) || !isDefined(workspaceMember)) {
      throw new Error(
        `Importing workspace member not found for user ${user.id}`,
      );
    }

    const roleId = await this.userRoleService.getRoleIdForUserWorkspace({
      userWorkspaceId: createdByUserWorkspaceId,
      workspaceId,
    });

    return {
      authContext: buildUserAuthContext({
        workspace: { id: workspaceId } as FlatWorkspace,
        userWorkspaceId: createdByUserWorkspaceId,
        user: fromUserEntityToFlat(user),
        workspaceMemberId,
        workspaceMember,
      }),
      rolePermissionConfig: { unionOf: [roleId] },
      actorMetadata: {
        source: FieldActorSource.IMPORT,
        workspaceMemberId,
        name: [user.firstName, user.lastName].filter(Boolean).join(' '),
        context: {},
      },
    };
  }
}
