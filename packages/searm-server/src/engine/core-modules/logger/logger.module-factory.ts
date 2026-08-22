import {
  LoggerDriverType,
  type LoggerModuleOptions,
} from 'src/engine/core-modules/logger/interfaces';
import { type SearmConfigService } from 'src/engine/core-modules/searm-config/searm-config.service';

/**
 * Logger Module factory
 * @returns LoggerModuleOptions
 * @param searmConfigService
 */
export const loggerModuleFactory = async (
  searmConfigService: SearmConfigService,
): Promise<LoggerModuleOptions> => {
  const driverType = searmConfigService.get('LOGGER_DRIVER');
  const logLevels = searmConfigService.get('LOG_LEVELS');

  switch (driverType) {
    case LoggerDriverType.CONSOLE: {
      return {
        type: LoggerDriverType.CONSOLE,
        logLevels: logLevels,
      };
    }
    default:
      throw new Error(
        `Invalid logger driver type (${driverType}), check your .env file`,
      );
  }
};
