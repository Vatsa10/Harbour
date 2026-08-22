import { Test, type TestingModule } from '@nestjs/testing';

import { TOOL_PROVIDERS } from 'src/engine/core-modules/tool-provider/constants/tool-providers.token';
import { ToolExecutorService } from 'src/engine/core-modules/tool-provider/services/tool-executor.service';
import { ToolRegistryService } from 'src/engine/core-modules/tool-provider/services/tool-registry.service';
import { ToolOutputSpillService } from 'src/engine/core-modules/tool/services/tool-output-spill.service';

const context = {
  workspaceId: 'workspace-1',
  roleId: 'role-1',
};

describe('ToolRegistryService failure envelope', () => {
  let service: ToolRegistryService;

  const provider = {
    category: 'DATABASE_CRUD',
    isAvailable: jest.fn().mockResolvedValue(true),
    generateDescriptors: jest.fn().mockResolvedValue([
      {
        name: 'find_many_people',
        label: 'Find people',
        description: 'Find people',
        category: 'DATABASE_CRUD',
        executionRef: {
          kind: 'database_crud',
          objectNameSingular: 'person',
          operation: 'find_many',
        },
      },
    ]),
  };

  const toolExecutorService = { dispatch: jest.fn() };
  const toolOutputSpillService = { spillIfTooLarge: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ToolRegistryService,
        { provide: TOOL_PROVIDERS, useValue: [provider] },
        { provide: ToolExecutorService, useValue: toolExecutorService },
        { provide: ToolOutputSpillService, useValue: toolOutputSpillService },
      ],
    }).compile();

    service = module.get<ToolRegistryService>(ToolRegistryService);
  });

  it('should return an UNKNOWN_TOOL failure with a suggestion for a near-miss name', async () => {
    // One char off the real tool name so findSimilarToolNames' edit-distance
    // threshold (real seam, not mocked) actually surfaces a suggestion.
    const output = await service.resolveAndExecute(
      'find_many_peopl',
      {},
      context,
    );

    expect(output.success).toBe(false);
    expect(output.failure?.code).toBe('UNKNOWN_TOOL');
    expect(output.failure?.allowedActions).toContain('find_many_people');
    expect(toolExecutorService.dispatch).not.toHaveBeenCalled();
  });

  it('should return an INTERNAL_ERROR failure when dispatch throws', async () => {
    toolExecutorService.dispatch.mockRejectedValue(new Error('boom'));

    const output = await service.resolveAndExecute(
      'find_many_people',
      {},
      context,
    );

    expect(output.success).toBe(false);
    expect(output.failure?.code).toBe('INTERNAL_ERROR');
    expect(output.failure?.retryable).toBe(true);
  });
});
