import { computeMetadataNamesFromLabelsOrThrow } from 'searm-shared/metadata';

export const computeMetadataNamesFromLabels = (
  labelSingular: string,
  labelPlural: string,
): { nameSingular: string; namePlural: string } => {
  try {
    return computeMetadataNamesFromLabelsOrThrow({
      labelSingular,
      labelPlural,
    });
  } catch {
    return { nameSingular: '', namePlural: '' };
  }
};
