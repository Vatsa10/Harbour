import { Test, type TestingModule } from '@nestjs/testing';

import { getQueueToken } from 'src/engine/core-modules/message-queue/utils/get-queue-token.util';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { CalendarEventExtractionJob } from 'src/modules/structured-extraction/jobs/calendar-event-extraction.job';
import { MessageExtractionJob } from 'src/modules/structured-extraction/jobs/message-extraction.job';
import { CalendarEventExtractionListener } from 'src/modules/structured-extraction/listeners/calendar-event-extraction.listener';
import { MessageExtractionListener } from 'src/modules/structured-extraction/listeners/message-extraction.listener';
import { AiExtractionExclusionService } from 'src/modules/structured-extraction/services/ai-extraction-exclusion.service';

// The one property these listeners exist to guarantee: the owner's exclusion
// is answered BEFORE anything about the content reaches a queue.
describe('structured extraction enqueue boundary', () => {
  const exclusionService = {
    isMessageExcluded: jest.fn(),
    isCalendarEventExcluded: jest.fn(),
  };
  const messageQueueService = { add: jest.fn() };

  let messageListener: MessageExtractionListener;
  let calendarListener: CalendarEventExtractionListener;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageExtractionListener,
        CalendarEventExtractionListener,
        {
          provide: AiExtractionExclusionService,
          useValue: exclusionService,
        },
        {
          provide: getQueueToken(MessageQueue.aiQueue),
          useValue: messageQueueService,
        },
      ],
    }).compile();

    messageListener = module.get(MessageExtractionListener);
    calendarListener = module.get(CalendarEventExtractionListener);
  });

  const messageBatch = (recordIds: string[]) =>
    ({
      workspaceId: 'workspace-1',
      events: recordIds.map((recordId) => ({
        recordId,
        properties: { after: { id: recordId } },
      })),
    }) as never;

  const calendarBatch = (recordIds: string[]) => messageBatch(recordIds);

  describe('messages', () => {
    it('should enqueue ids only for a message whose account allows extraction', async () => {
      exclusionService.isMessageExcluded.mockResolvedValue(false);

      await messageListener.handleMessageCreated(messageBatch(['message-1']));

      expect(exclusionService.isMessageExcluded).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        messageId: 'message-1',
      });
      expect(messageQueueService.add).toHaveBeenCalledWith(
        MessageExtractionJob.name,
        { workspaceId: 'workspace-1', messageId: 'message-1' },
      );
    });

    it('should never enqueue a message from an excluded account', async () => {
      exclusionService.isMessageExcluded.mockResolvedValue(true);

      await messageListener.handleMessageCreated(messageBatch(['message-1']));

      expect(messageQueueService.add).not.toHaveBeenCalled();
    });

    it('should suppress only the excluded message in a mixed batch', async () => {
      exclusionService.isMessageExcluded.mockImplementation(
        async ({ messageId }: { messageId: string }) =>
          messageId === 'excluded-message',
      );

      await messageListener.handleMessageCreated(
        messageBatch(['excluded-message', 'allowed-message']),
      );

      expect(messageQueueService.add).toHaveBeenCalledTimes(1);
      expect(messageQueueService.add).toHaveBeenCalledWith(
        MessageExtractionJob.name,
        { workspaceId: 'workspace-1', messageId: 'allowed-message' },
      );
    });

    it('should check exclusion before enqueueing, not after', async () => {
      const callOrder: string[] = [];

      exclusionService.isMessageExcluded.mockImplementation(async () => {
        callOrder.push('exclusion-check');

        return false;
      });
      messageQueueService.add.mockImplementation(async () => {
        callOrder.push('enqueue');
      });

      await messageListener.handleMessageCreated(messageBatch(['message-1']));

      expect(callOrder).toEqual(['exclusion-check', 'enqueue']);
    });

    it('should put no message content in the job payload', async () => {
      exclusionService.isMessageExcluded.mockResolvedValue(false);

      await messageListener.handleMessageCreated(messageBatch(['message-1']));

      const [, payload] = messageQueueService.add.mock.calls[0];

      expect(Object.keys(payload).sort()).toEqual(['messageId', 'workspaceId']);
    });
  });

  describe('calendar events', () => {
    it('should enqueue ids only for an event whose account allows extraction', async () => {
      exclusionService.isCalendarEventExcluded.mockResolvedValue(false);

      await calendarListener.handleCalendarEventCreated(
        calendarBatch(['event-1']),
      );

      expect(exclusionService.isCalendarEventExcluded).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        calendarEventId: 'event-1',
      });
      expect(messageQueueService.add).toHaveBeenCalledWith(
        CalendarEventExtractionJob.name,
        { workspaceId: 'workspace-1', calendarEventId: 'event-1' },
      );
    });

    it('should never enqueue an event from an excluded account', async () => {
      exclusionService.isCalendarEventExcluded.mockResolvedValue(true);

      await calendarListener.handleCalendarEventCreated(
        calendarBatch(['event-1']),
      );

      expect(messageQueueService.add).not.toHaveBeenCalled();
    });
  });
});
