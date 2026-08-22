import { type I18n } from '@lingui/core';

import { isDefined } from 'searm-shared/utils';

import { translateStandardLabel } from 'src/engine/core-modules/i18n/utils/translate-standard-label.util';
import { type PageLayoutWidgetOverrides } from 'src/engine/metadata-modules/page-layout-widget/entities/page-layout-widget.entity';

export const resolvePageLayoutWidgetTitle = ({
  title,
  applicationId,
  searmStandardApplicationId,
  overrides,
  i18nInstance,
  applicationCatalog,
}: {
  title: string;
  applicationId: string;
  searmStandardApplicationId: string;
  overrides?: PageLayoutWidgetOverrides | null;
  i18nInstance: I18n;
  applicationCatalog?: Record<string, string>;
}): string => {
  const isStandardApp = applicationId === searmStandardApplicationId;

  if (isDefined(overrides?.title)) {
    return title;
  }

  return translateStandardLabel({
    sourceValue: title,
    isStandardApp,
    applicationCatalog,
    i18nInstance,
  });
};
