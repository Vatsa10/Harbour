import { Module } from '@nestjs/common';

import { GuidedImportModule } from 'src/modules/guided-import/guided-import.module';
import { ImportExecutionJob } from 'src/modules/guided-import/jobs/import-execution.job';

@Module({
  imports: [GuidedImportModule],
  providers: [ImportExecutionJob],
})
export class ImportExecutionJobModule {}
