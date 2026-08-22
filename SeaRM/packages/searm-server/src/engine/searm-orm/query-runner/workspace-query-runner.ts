import { type QueryRunner } from 'typeorm';

import { type WorkspaceEntityManager } from 'src/engine/searm-orm/entity-manager/workspace-entity-manager';

interface WorkspaceQueryRunner extends Omit<QueryRunner, 'manager'> {
  manager: WorkspaceEntityManager;
}

export { WorkspaceQueryRunner };
