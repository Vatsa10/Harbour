import { type FrontComponentManifest } from 'searm-shared/application';

export type FrontComponentType = React.ComponentType<any>;

export type FrontComponentConfig = Omit<
  FrontComponentManifest,
  | 'sourceComponentPath'
  | 'builtComponentPath'
  | 'builtComponentChecksum'
  | 'componentName'
  | 'usesSdkClient'
> & {
  component: FrontComponentType;
};
