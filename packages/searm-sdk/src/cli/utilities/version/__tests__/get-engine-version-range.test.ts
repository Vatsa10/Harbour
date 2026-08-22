import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getEngineVersionRange } from '@/cli/utilities/version/get-engine-version-range';

describe('getEngineVersionRange', () => {
  const createdDirs: string[] = [];

  const seed = (contents: unknown): string => {
    const dir = mkdtempSync(join(tmpdir(), 'searm-app-server-range-'));

    writeFileSync(join(dir, 'package.json'), JSON.stringify(contents), 'utf-8');
    createdDirs.push(dir);

    return dir;
  };

  afterEach(() => {
    while (createdDirs.length > 0) {
      rmSync(createdDirs.pop() as string, { recursive: true, force: true });
    }
  });

  it('returns the engines.searm range', () => {
    const dir = seed({ engines: { searm: '>=2.2.0' } });

    expect(getEngineVersionRange(dir)).toBe('>=2.2.0');
  });

  it('trims surrounding whitespace', () => {
    const dir = seed({ engines: { searm: '  ^2.2.0  ' } });

    expect(getEngineVersionRange(dir)).toBe('^2.2.0');
  });

  it('returns null when engines.searm is missing', () => {
    const dir = seed({ engines: { node: '^24.0.0' } });

    expect(getEngineVersionRange(dir)).toBeNull();
  });

  it('returns null when engines.searm is empty', () => {
    const dir = seed({ engines: { searm: '   ' } });

    expect(getEngineVersionRange(dir)).toBeNull();
  });

  it('returns null when engines.searm is not a string', () => {
    const dir = seed({ engines: { searm: 2 } });

    expect(getEngineVersionRange(dir)).toBeNull();
  });

  it('returns null when no package.json exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'searm-app-server-range-empty-'));

    createdDirs.push(dir);

    expect(getEngineVersionRange(dir)).toBeNull();
  });
});
