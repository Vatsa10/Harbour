import { getLambdaResourceNamespace } from 'src/engine/core-modules/logic-function/logic-function-drivers/drivers/lambda/utils/get-lambda-resource-namespace.util';

describe('getLambdaResourceNamespace', () => {
  it('returns a stable 10-character hex namespace for a role ARN', () => {
    const lambdaRoleArn = 'arn:aws:iam::123456789012:role/searm-lambda';

    const namespace = getLambdaResourceNamespace({ lambdaRoleArn });

    expect(namespace).toMatch(/^[0-9a-f]{10}$/);
    expect(getLambdaResourceNamespace({ lambdaRoleArn })).toBe(namespace);
  });

  it('produces different namespaces for different role ARNs', () => {
    const namespaceA = getLambdaResourceNamespace({
      lambdaRoleArn: 'arn:aws:iam::111111111111:role/searm-lambda',
    });
    const namespaceB = getLambdaResourceNamespace({
      lambdaRoleArn: 'arn:aws:iam::222222222222:role/searm-lambda',
    });

    expect(namespaceA).not.toBe(namespaceB);
  });

  it.each([undefined, ''])(
    'falls back to a stable sentinel namespace when the role is missing (%p)',
    (lambdaRoleArn) => {
      const namespace = getLambdaResourceNamespace({ lambdaRoleArn });

      expect(namespace).toMatch(/^[0-9a-f]{10}$/);
      expect(getLambdaResourceNamespace({ lambdaRoleArn })).toBe(namespace);
    },
  );
});
