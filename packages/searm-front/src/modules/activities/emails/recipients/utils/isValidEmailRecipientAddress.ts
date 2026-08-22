import { emailSchema } from 'searm-shared/utils';

export const isValidEmailRecipientAddress = (address: string): boolean =>
  emailSchema.safeParse(address).success;
