import { Test, type TestingModule } from '@nestjs/testing';

import { KeyValuePairService } from 'src/engine/core-modules/key-value-pair/key-value-pair.service';
import { AiWritePolicyService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/ai-write-policy.service';
import {
  DEFAULT_AI_WRITE_POLICY,
  type AiWritePolicy,
  type AiWritePolicyTarget,
} from 'src/engine/metadata-modules/ai/ai-write-approval/types/ai-write-policy.type';

describe('AiWritePolicyService', () => {
  let service: AiWritePolicyService;
  const keyValuePairService = { get: jest.fn(), set: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiWritePolicyService,
        { provide: KeyValuePairService, useValue: keyValuePairService },
      ],
    }).compile();

    service = module.get<AiWritePolicyService>(AiWritePolicyService);
  });

  describe('getPolicy', () => {
    it('should return the default policy when nothing is stored', async () => {
      keyValuePairService.get.mockResolvedValue(undefined);

      const policy = await service.getPolicy('workspace-1');

      expect(policy).toEqual(DEFAULT_AI_WRITE_POLICY);
    });

    it('should return the stored policy when one exists', async () => {
      const stored: AiWritePolicy = {
        default: 'AUTO',
        overrides: { 'person.email': 'FORBID' },
      };

      keyValuePairService.get.mockResolvedValue(stored);

      const policy = await service.getPolicy('workspace-1');

      expect(policy).toEqual(stored);
    });

    it('should unwrap the key value pair rows returned by the real service', async () => {
      const stored: AiWritePolicy = {
        default: 'FORBID',
        overrides: { company: 'AUTO' },
      };

      keyValuePairService.get.mockResolvedValue([{ value: stored }]);

      const policy = await service.getPolicy('workspace-1');

      expect(policy).toEqual(stored);
    });

    it('should return the default policy when no row is found', async () => {
      keyValuePairService.get.mockResolvedValue([]);

      const policy = await service.getPolicy('workspace-1');

      expect(policy).toEqual(DEFAULT_AI_WRITE_POLICY);
    });

    it('should drop override values that are not modes', async () => {
      keyValuePairService.get.mockResolvedValue([
        { value: { default: 'OOPS', overrides: { person: 42, company: 'AUTO' } } },
      ]);

      const policy = await service.getPolicy('workspace-1');

      expect(policy).toEqual({ default: 'PROPOSE', overrides: { company: 'AUTO' } });
    });
  });

  describe('resolveMode', () => {
    const policy: AiWritePolicy = {
      default: 'PROPOSE',
      overrides: {
        'person.linkedinLink': 'AUTO',
        'person.email': 'FORBID',
        company: 'AUTO',
      },
    };

    const recordTarget = (
      objectNameSingular: string,
      fieldNames: string[],
    ): AiWritePolicyTarget => ({
      kind: 'record',
      objectNameSingular,
      fieldNames,
    });

    it('should fall back to the default when nothing matches', () => {
      expect(service.resolveMode(policy, recordTarget('person', ['jobTitle']))).toBe(
        'PROPOSE',
      );
    });

    // The bug: the object key used to be unioned in and dragged the default
    // into every resolution, so a field-level AUTO could never win.
    it('should let a field override win over the workspace default', () => {
      expect(
        service.resolveMode(policy, recordTarget('person', ['linkedinLink'])),
      ).toBe('AUTO');
    });

    it('should let an object override win over the workspace default', () => {
      expect(service.resolveMode(policy, recordTarget('company', ['name']))).toBe(
        'AUTO',
      );
    });

    it('should prefer the more specific field override over the object override', () => {
      expect(
        service.resolveMode(
          { default: 'AUTO', overrides: { person: 'AUTO', 'person.email': 'FORBID' } },
          recordTarget('person', ['email']),
        ),
      ).toBe('FORBID');
    });

    it('should cover every field of a write through its object override', () => {
      expect(
        service.resolveMode(
          { default: 'PROPOSE', overrides: { person: 'AUTO' } },
          recordTarget('person', ['linkedinLink', 'jobTitle']),
        ),
      ).toBe('AUTO');
    });

    it('should return the most restrictive mode across several fields', () => {
      expect(
        service.resolveMode(policy, recordTarget('person', ['linkedinLink', 'email'])),
      ).toBe('FORBID');
    });

    it('should fall to the object override when a write names no fields', () => {
      expect(service.resolveMode(policy, recordTarget('company', []))).toBe('AUTO');
      expect(service.resolveMode(policy, recordTarget('person', []))).toBe('PROPOSE');
    });

    it('should resolve a static tool on its tool id', () => {
      expect(
        service.resolveMode(
          { default: 'PROPOSE', overrides: { send_email: 'FORBID' } },
          { kind: 'tool', toolId: 'send_email' },
        ),
      ).toBe('FORBID');
      expect(
        service.resolveMode(
          { default: 'PROPOSE', overrides: {} },
          { kind: 'tool', toolId: 'send_email' },
        ),
      ).toBe('PROPOSE');
    });
  });
});
