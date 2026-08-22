import { type I18n } from '@lingui/core';

import { isDefined } from 'searm-shared/utils';

import { translateStandardLabel } from 'src/engine/core-modules/i18n/utils/translate-standard-label.util';
import { type ViewFieldGroupOverrides } from 'src/engine/metadata-modules/view-field-group/entities/view-field-group.entity';

export const resolveViewFieldGroupName = ({
  name,
  applicationId,
  searmStandardApplicationId,
  overrides,
  i18nInstance,
  applicationCatalog,
}: {
  name: string;
  applicationId: string;
  searmStandardApplicationId: string;
  overrides?: ViewFieldGroupOverrides | null;
  i18nInstance: I18n;
  applicationCatalog?: Record<string, string>;
}): string => {
  const isStandardApp = applicationId === searmStandardApplicationId;

  if (isDefined(overrides?.name)) {
    return name;
  }

  return translateStandardLabel({
    sourceValue: name,
    isStandardApp,
    applicationCatalog,
    i18nInstance,
  });
};
