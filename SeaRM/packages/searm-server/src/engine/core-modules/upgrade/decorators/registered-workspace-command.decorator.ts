import 'reflect-metadata';
import { SearmAllVersion } from 'src/engine/core-modules/upgrade/constants/searm-all-versions.constant';

export type RegisteredWorkspaceCommandMetadata = {
  version: SearmAllVersion;
  timestamp: number;
};

const REGISTERED_WORKSPACE_COMMAND_KEY = 'REGISTERED_WORKSPACE_COMMAND';

export const RegisteredWorkspaceCommand =
  (version: SearmAllVersion, timestamp: number): ClassDecorator =>
  (target) => {
    Reflect.defineMetadata(
      REGISTERED_WORKSPACE_COMMAND_KEY,
      { version, timestamp },
      target,
    );
  };

export const getRegisteredWorkspaceCommandMetadata = (
  target: Function,
): RegisteredWorkspaceCommandMetadata | undefined =>
  Reflect.getMetadata(REGISTERED_WORKSPACE_COMMAND_KEY, target);
