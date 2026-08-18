import { EnterprisePlanService } from 'src/engine/core-modules/enterprise/services/enterprise-plan.service';

describe('EnterprisePlanService', () => {
  const service = new EnterprisePlanService();

  it('always reports a valid plan', () => {
    expect(service.isValid()).toBe(true);
  });

  it('always reports a valid signed enterprise key', () => {
    expect(service.hasValidSignedEnterpriseKey()).toBe(true);
  });

  it('always reports a valid enterprise validity token', () => {
    expect(service.hasValidEnterpriseValidityToken()).toBe(true);
  });
});
