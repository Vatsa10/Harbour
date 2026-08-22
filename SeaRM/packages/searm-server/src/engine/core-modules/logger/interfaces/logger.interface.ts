import { type LogLevel } from '@nestjs/common';

export type SearmLogLevel = LogLevel | 'performance';

export enum LoggerDriverType {
  CONSOLE = 'CONSOLE',
}

export interface ConsoleDriverFactoryOptions {
  type: LoggerDriverType.CONSOLE;
  logLevels?: SearmLogLevel[];
}

export type LoggerModuleOptions = ConsoleDriverFactoryOptions;
