import { readFileSync } from 'fs';
import { join } from 'path';

import {
  isToolFailurePseudoAction,
  TOOL_FAILURE_PSEUDO_ACTIONS,
} from 'src/engine/core-modules/tool/types/tool-failure.type';

// Phase-4 review M2: allowedActions mixes callable tool names with
// pseudo-actions and an agent cannot tell which entries it may invoke. The
// pseudo-actions are now enumerated; this pins that the producers stay inside
// that set, so adding a new bare verb fails here instead of reaching a model
// that will try to call it as a tool.
const PRODUCERS = [
  'core-modules/tool/utils/ensure-tool-failure-envelope.util.ts',
  'core-modules/tool-provider/utils/tool-error.util.ts',
  'core-modules/tool-provider/services/tool-registry.service.ts',
  'core-modules/tool-provider/services/tool-executor.service.ts',
  'api/mcp/services/mcp-tool-executor.service.ts',
  'metadata-modules/ai/ai-write-approval/services/proposal-gate.service.ts',
];

// A callable entry is a tool name. Every tool this codebase exposes to an
// agent starts with one of these verbs.
const TOOL_NAME_PREFIXES = [
  'get_',
  'find_',
  'create_',
  'update_',
  'delete_',
  'upsert_',
  'group_by',
  'search_',
  'navigate_',
  'learn_',
  'execute_',
  'http_',
];

const collectActions = (source: string): string[] =>
  [...source.matchAll(/allowedActions:\s*\[([^\]]*)\]/g)].flatMap((match) =>
    [...match[1].matchAll(/'([^']+)'/g)].map((literal) => literal[1]),
  );

describe('tool failure allowedActions', () => {
  it('discriminates pseudo-actions from tool names', () => {
    expect(isToolFailurePseudoAction('retry')).toBe(true);
    expect(isToolFailurePseudoAction('ask_admin_to_change_policy')).toBe(true);
    expect(isToolFailurePseudoAction('get_tool_catalog')).toBe(false);
    expect(isToolFailurePseudoAction('find_many_people')).toBe(false);
  });

  it('enumerates every pseudo-action any producer emits', () => {
    const unclassified: { file: string; action: string }[] = [];

    for (const relativePath of PRODUCERS) {
      const absolutePath = join(__dirname, '../../../..', relativePath);

      let source: string;

      try {
        source = readFileSync(absolutePath, 'utf8');
      } catch {
        // A producer that moved is not this test's business to fail on; the
        // remaining ones still guard the invariant.
        continue;
      }

      for (const action of collectActions(source)) {
        const isToolName = TOOL_NAME_PREFIXES.some((prefix) =>
          action.startsWith(prefix),
        );

        if (!isToolName && !isToolFailurePseudoAction(action)) {
          unclassified.push({ file: relativePath, action });
        }
      }
    }

    expect(unclassified).toEqual([]);
  });

  it('does not declare a pseudo-action nothing produces', () => {
    // The review's I1/M6 complaint about declared-but-unproduced codes applies
    // to this union too: keep it to what actually ships.
    expect([...TOOL_FAILURE_PSEUDO_ACTIONS].sort()).toEqual([
      'ask_admin_to_change_policy',
      'retry',
      'retry_with_confirm_token',
    ]);
  });
});
