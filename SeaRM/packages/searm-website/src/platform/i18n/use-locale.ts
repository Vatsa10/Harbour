'use client';

import { useContext } from 'react';
import { type DocumentationSupportedLanguage } from 'searm-shared/constants';

import { LocaleContext } from './locale-context';

export const useLocale = (): DocumentationSupportedLanguage =>
  useContext(LocaleContext);
