import { isDefined } from 'searm-shared/utils';

export const resolveCjsModuleDefaultExport = <TDefaultExport>(
  importedModule: TDefaultExport,
): TDefaultExport => {
  const defaultExport = (importedModule as { default?: TDefaultExport })
    .default;

  return isDefined(defaultExport) ? defaultExport : importedModule;
};
