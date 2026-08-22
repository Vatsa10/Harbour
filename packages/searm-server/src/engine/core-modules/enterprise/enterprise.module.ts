import { Module } from '@nestjs/common';

import { EnterprisePlanService } from 'src/engine/core-modules/enterprise/services/enterprise-plan.service';

@Module({
  providers: [EnterprisePlanService],
  exports: [EnterprisePlanService],
})
export class EnterpriseModule {}
