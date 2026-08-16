import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';

import { FieldActorSource } from 'twenty-shared/types';

import { CommonUpdateOneQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-update-one-query-runner.service';
import { CommonApiContextBuilderService } from 'src/engine/core-modules/record-crud/services/common-api-context-builder.service';
import { UpdateRecordService } from 'src/engine/core-modules/record-crud/services/update-record.service';
import type { WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';

const RECORD_ID = '20202020-1111-4111-8111-000000000001';

describe('UpdateRecordService', () => {
  let service: UpdateRecordService;
  let runnerExecute: jest.Mock;

  const buildContext = (nameSingular: string) => ({
    queryRunnerContext: {},
    selectedFields: {},
    flatObjectMetadata: { nameSingular },
    flatFieldMetadataMaps: {},
  });

  const setup = async (nameSingular: string) => {
    runnerExecute = jest.fn(async () => ({ results: { id: RECORD_ID } }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpdateRecordService,
        {
          provide: CommonUpdateOneQueryRunnerService,
          useValue: { execute: runnerExecute },
        },
        {
          provide: CommonApiContextBuilderService,
          useValue: { build: jest.fn(async () => buildContext(nameSingular)) },
        },
      ],
    }).compile();

    service = module.get(UpdateRecordService);
  };

  const execute = (params: Record<string, unknown> = {}) =>
    service.execute({
      objectName: 'person',
      objectRecordId: RECORD_ID,
      objectRecord: { jobTitle: 'CTO' },
      authContext: {} as WorkspaceAuthContext,
      ...params,
    });

  describe('automation blocklist', () => {
    it('should refuse a write to a blocked object without the human-approval flag', async () => {
      await setup('messageParticipant');

      const output = await execute({ objectName: 'messageParticipant' });

      expect(output.success).toBe(false);
      expect(output.error).toContain('cannot be updated by automation');
      expect(runnerExecute).not.toHaveBeenCalled();
    });

    it('should allow a write to a blocked object when a human approved it', async () => {
      await setup('messageParticipant');

      const output = await execute({
        objectName: 'messageParticipant',
        objectRecord: { personId: 'person-1' },
        isHumanApproved: true,
      });

      expect(output.success).toBe(true);
      expect(runnerExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          id: RECORD_ID,
          data: expect.objectContaining({ personId: 'person-1' }),
        }),
        expect.anything(),
      );
    });

    it('should still refuse an unflagged write after a flagged one', async () => {
      await setup('messageParticipant');

      await execute({ objectName: 'messageParticipant', isHumanApproved: true });
      runnerExecute.mockClear();

      const output = await execute({ objectName: 'messageParticipant' });

      expect(output.success).toBe(false);
      expect(runnerExecute).not.toHaveBeenCalled();
    });
  });

  describe('actor', () => {
    it('should carry an explicit updatedBy through to the written data', async () => {
      await setup('person');

      await execute({
        updatedBy: { source: FieldActorSource.IMPORT, name: 'Jane Doe' },
      });

      expect(runnerExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            updatedBy: { source: FieldActorSource.IMPORT, name: 'Jane Doe' },
          }),
        }),
        expect.anything(),
      );
    });

    it('should not invent an updatedBy when none was supplied', async () => {
      await setup('person');

      await execute();

      const [{ data }] = runnerExecute.mock.calls[0];

      expect(data).not.toHaveProperty('updatedBy');
    });
  });
});
