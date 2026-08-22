import { getTimezoneAbbreviationForZonedDateTime } from '@/ui/input/components/internal/date/utils/getTimeZoneAbbreviationForZonedDateTime';
import { Temporal } from 'temporal-polyfill';

import { type RelativeDateFilter } from 'searm-shared/utils';

export const getRelativeDateFilterTimeZoneAbbreviation = (
  relativeDate: RelativeDateFilter,
) => {
  const nowZonedDateTime = Temporal.Now.zonedDateTimeISO(
    relativeDate.timezone ?? 'UTC',
  );

  const timeZoneAbbreviation =
    getTimezoneAbbreviationForZonedDateTime(nowZonedDateTime);

  return timeZoneAbbreviation;
};
