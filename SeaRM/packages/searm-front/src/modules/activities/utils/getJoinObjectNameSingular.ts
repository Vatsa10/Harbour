import { CoreObjectNameSingular } from 'searm-shared/types';

export const getJoinObjectNameSingular = (
  objectNameSingular: CoreObjectNameSingular,
) => {
  return objectNameSingular === CoreObjectNameSingular.Note
    ? CoreObjectNameSingular.NoteTarget
    : objectNameSingular === CoreObjectNameSingular.Task
      ? CoreObjectNameSingular.TaskTarget
      : '';
};
