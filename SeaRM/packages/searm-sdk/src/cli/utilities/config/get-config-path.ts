import * as os from 'os';
import * as path from 'path';

const SEARM_DIR = path.join(os.homedir(), '.searm');

export const getConfigPath = (test = false): string => {
  if (test || process.env.NODE_ENV === 'test') {
    return path.join(SEARM_DIR, 'config.test.json');
  }

  return path.join(SEARM_DIR, 'config.json');
};
