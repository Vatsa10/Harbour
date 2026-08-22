import path from 'path';

import { ASSET_PATH } from 'src/constants/assets-path';

const IS_BUILT =
  __dirname.includes('/dist/') && process.env.NODE_ENV !== 'development';

// In built mode the package is copied into dist/assets/ by the build step.
// In dev mode it lives in node_modules via the monorepo workspace — resolve
// from the searm-client-sdk/core entry point and navigate up to the package root.
export const SDK_CLIENT_PACKAGE_DIRNAME = IS_BUILT
  ? path.join(ASSET_PATH, 'searm-client-sdk')
  : path.resolve(require.resolve('searm-client-sdk/core'), '..', '..');
