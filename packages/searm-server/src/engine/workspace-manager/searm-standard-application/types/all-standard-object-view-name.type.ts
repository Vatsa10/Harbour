import { type AllStandardObjectName } from 'src/engine/workspace-manager/searm-standard-application/types/all-standard-object-name.type';
import { type AllStandardObjectView } from 'src/engine/workspace-manager/searm-standard-application/types/all-standard-object-view.type';

export type AllStandardObjectViewName<T extends AllStandardObjectName> =
  AllStandardObjectView<T> extends never
    ? never
    : keyof AllStandardObjectView<T>;
