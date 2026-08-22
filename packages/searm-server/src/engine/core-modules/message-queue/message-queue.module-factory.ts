import {
  type BullMQDriverFactoryOptions,
  MessageQueueDriverType,
  type MessageQueueModuleOptions,
} from 'src/engine/core-modules/message-queue/interfaces';
import { type MetricsService } from 'src/engine/core-modules/metrics/metrics.service';
import { type RedisClientService } from 'src/engine/core-modules/redis-client/redis-client.service';
import { type SearmConfigService } from 'src/engine/core-modules/searm-config/searm-config.service';

/**
 * MessageQueue Module factory
 * @returns MessageQueueModuleOptions
 * @param searmConfigService
 * @param redisClientService
 * @param metricsService
 */
export const messageQueueModuleFactory = async (
  searmConfigService: SearmConfigService,
  redisClientService: RedisClientService,
  metricsService: MetricsService,
): Promise<MessageQueueModuleOptions> => {
  const driverType = MessageQueueDriverType.BullMQ;

  switch (driverType) {
    case MessageQueueDriverType.BullMQ: {
      return {
        type: MessageQueueDriverType.BullMQ,
        options: {
          connection: redisClientService.getQueueClient(),
        },
        metricsService,
        searmConfigService,
      } satisfies BullMQDriverFactoryOptions;
    }
    default:
      throw new Error(
        `Invalid message queue driver type (${driverType}), check your .env file`,
      );
  }
};
