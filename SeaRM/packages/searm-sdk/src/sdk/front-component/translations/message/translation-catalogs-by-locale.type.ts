import { type AppLocale } from 'searm-shared/translations';

export type TranslationCatalogsByLocale = Partial<
  Record<AppLocale, Record<string, string>>
>;
