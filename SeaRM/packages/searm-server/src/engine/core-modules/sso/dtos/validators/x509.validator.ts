import { X509Certificate } from 'node:crypto';

import {
  registerDecorator,
  type ValidationOptions,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

// A malformed/non-PEM certificate here means SAML signature verification can
// never succeed later, or worse, a permissive XML library silently skips
// validation. Reject anything that Node's own X.509 parser cannot parse.
@ValidatorConstraint({ name: 'isX509Certificate', async: false })
class IsX509CertificateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return false;
    }

    try {
      // eslint-disable-next-line no-new
      new X509Certificate(value);

      return true;
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return 'certificate must be a valid PEM-encoded X.509 certificate';
  }
}

export function IsX509Certificate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsX509CertificateConstraint,
    });
  };
}
