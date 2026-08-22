import { EventLogTable } from 'searm-shared/types';

import { ClickHouseService } from 'src/database/clickHouse/clickHouse.service';
import { EventLogsExceptionCode } from 'src/engine/core-modules/event-logs/event-logs.exception';
import { EventLogsService } from 'src/engine/core-modules/event-logs/event-logs.service';

describe('EventLogsService.validateAccess', () => {
  let service: EventLogsService;
  let getMainClient: jest.Mock;

  beforeEach(() => {
    getMainClient = jest.fn().mockReturnValue({});

    service = new EventLogsService({
      getMainClient,
    } as unknown as ClickHouseService);
  });

  const validateAccessError = async (table: EventLogTable) =>
    service.validateAccess('ws-1', table).then(
      () => undefined,
      (error) => error,
    );

  it('throws CLICKHOUSE_NOT_CONFIGURED when ClickHouse is unavailable', async () => {
    getMainClient.mockReturnValue(undefined);

    const error = await validateAccessError(EventLogTable.WORKSPACE_EVENT);

    expect(error?.code).toBe(EventLogsExceptionCode.CLICKHOUSE_NOT_CONFIGURED);
  });

  it('allows application logs', async () => {
    await expect(
      service.validateAccess('ws-1', EventLogTable.APPLICATION_LOG),
    ).resolves.toBeUndefined();
  });
});
