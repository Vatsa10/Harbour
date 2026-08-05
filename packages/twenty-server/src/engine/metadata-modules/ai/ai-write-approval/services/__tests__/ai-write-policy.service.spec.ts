import { Test, type TestingModule } from '@nestjs/testing';

import { KeyValuePairService } from 'src/engine/core-modules/key-value-pair/key-value-pair.service';
import { AiWritePolicyService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/ai-write-policy.service';
import {
  DEFAULT_AI_WRITE_POLICY,
  type AiWritePolicy,
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

    it('should fall back to the default when no key matches', () => {
      expect(service.resolveMode(policy, ['person.jobTitle'])).toBe('PROPOSE');
    });

    it('should use an exact override when one matches', () => {
      expect(service.resolveMode(policy, ['person.linkedinLink'])).toBe('AUTO');
    });

    it('should return the most restrictive mode across several keys', () => {
      expect(
        service.resolveMode(policy, ['person.linkedinLink', 'person.email']),
      ).toBe('FORBID');
    });

    it('should prefer PROPOSE over AUTO when keys disagree', () => {
      expect(
        service.resolveMode(policy, ['person.linkedinLink', 'person.jobTitle']),
      ).toBe('PROPOSE');
    });

    it('should return the default when no keys are supplied', () => {
      expect(service.resolveMode(policy, [])).toBe('PROPOSE');
    });
  });
});
