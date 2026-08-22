#!/usr/bin/env node
const message = `\nSeaRM CLI (searm-cli) is deprecated.\n\nPlease install and use the new package instead:\n  npm install -g searm-sdk\n\nThe command name remains the same: \"searm\".\nMore info: https://www.npmjs.com/package/searm-sdk\n`;

console.error(message);
process.exitCode = 1;
