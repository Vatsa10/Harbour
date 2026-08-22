import { v5 as uuidv5 } from 'uuid';

// A fixed namespace so the id is stable across processes and deploys: the
// installer needs to recognise its own row on the next run without storing a
// marker column. Derived from workspace + definition name, so two workspaces
// installing the same template never collide, and a workflow a user created
// by hand in the builder never answers an installer's idempotency lookup.
const INSTALLED_WORKFLOW_NAMESPACE = '4d3b3a4b-7c2f-4f7a-9a4c-6a3a2d1e0b55';

export const buildInstalledWorkflowId = (
  workspaceId: string,
  definitionName: string,
): string =>
  uuidv5(`${workspaceId}:${definitionName}`, INSTALLED_WORKFLOW_NAMESPACE);
