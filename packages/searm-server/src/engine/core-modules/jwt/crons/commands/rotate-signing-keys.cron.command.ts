// SeaRM — AGPL-3.0. Clean-room reimplementation of the JWT signing key
// rotation cron registration command (no SeaRM Enterprise source
// consulted; structural pattern independently confirmed against the
// purely-AGPL trash-cleanup.cron.command.ts and
// user-session-cleanup.cron.command.ts).

import { Command, CommandRunner } from 'nest-commander';

import { ROTATE_SIGNING_KEYS_CRON_PATTERN } from 'src/engine/core-modules/jwt/constants/rotate-signing-keys-cron-pattern.constant';
import { RotateSigningKeysCronJob } from 'src/engine/core-modules/jwt/crons/jobs/rotate-signing-keys.cron.job';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';

@Command({
  name: 'cron:rotate-signing-keys',
  description:
    'Starts a cron job that rotates the current JWT signing key once it exceeds SIGNING_KEY_ROTATION_DAYS',
})
export class RotateSigningKeysCronCommand extends CommandRunner {
  constructor(
    @InjectMessageQueue(MessageQueue.cronQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {
    super();
  }

  async run(): Promise<void> {
    await this.messageQueueService.addCron<undefined>({
      jobName: RotateSigningKeysCronJob.name,
      data: undefined,
      options: {
        repeat: {
          pattern: ROTATE_SIGNING_KEYS_CRON_PATTERN,
        },
      },
    });
  }
}
