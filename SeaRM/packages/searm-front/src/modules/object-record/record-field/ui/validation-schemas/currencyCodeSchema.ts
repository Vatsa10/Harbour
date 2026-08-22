import { z } from 'zod';

import { CurrencyCode } from 'searm-shared/constants';

export const currencyCodeSchema = z.enum(CurrencyCode);
