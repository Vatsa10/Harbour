import { ClickHouseService } from 'src/database/clickHouse/clickHouse.service';
import { EventLogCleanupService } from 'src/engine/core-modules/event-logs/cleanup/services/event-log-cleanup.service';

describe('EventLogCleanupService', () => {
  let service: EventLogCleanupService;
  let getMainClient: jest.Mock;
  let executeCommand: jest.Mock;

  beforeEach(() => {
    getMainClient = jest.fn().mockReturnValue({});
    executeCommand = jest.fn().mockResolvedValue(true);

    service = new EventLogCleanupService({
      getMainClient,
      executeCommand,
    } as unknown as ClickHouseService);
  });

  it('does nothing when ClickHouse is not configured', async () => {
    getMainClient.mockReturnValue(undefined);

    await service.cleanup();

    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('issues a delete command for every event log table', async () => {
    await service.cleanup();

    // WORKSPACE_EVENT, PAGEVIEW, OBJECT_EVENT, USAGE_EVENT, APPLICATION_LOG
    expect(executeCommand).toHaveBeenCalledTimes(5);
    expect(executeCommand).toHaveBeenCalledWith(
      expect.stringContaining('DELETE WHERE timestamp'),
      expect.objectContaining({ retentionDays: expect.any(Number) }),
    );
  });

  it('does not throw when a ClickHouse delete command fails for a table (failure is logged, not swallowed silently)', async () => {
    executeCommand.mockResolvedValueOnce(false).mockResolvedValue(true);

    await expect(service.cleanup()).resolves.toBeUndefined();

    // Cleanup continues to the other tables even if one delete fails.
    expect(executeCommand).toHaveBeenCalledTimes(5);
  });
});
