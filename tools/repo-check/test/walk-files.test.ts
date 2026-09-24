import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { listRepoFiles } from '../src/walk-files.ts';

const root = mkdtempSync(join(tmpdir(), 'repo-check-'));

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('listRepoFiles', () => {
  it('mengikuti git: file dilacak + baru, tanpa yang di-ignore, isi hanya untuk ekstensi yang dihitung', () => {
    execFileSync('git', ['init', '-q'], { cwd: root });
    mkdirSync(join(root, 'apps/api/src'), { recursive: true });
    mkdirSync(join(root, 'node_modules/x'), { recursive: true });
    writeFileSync(join(root, '.gitignore'), 'node_modules/\n.env\n');
    writeFileSync(join(root, '.env'), 'SECRET=1\n');
    writeFileSync(join(root, 'node_modules/x/index.js'), 'module.exports = 1;\n');
    writeFileSync(join(root, 'apps/api/src/main.ts'), 'export {};\n');
    writeFileSync(join(root, 'logo.png'), 'binary');

    const files = listRepoFiles(root);

    expect(files.map((f) => f.path)).toEqual(['.gitignore', 'apps/api/src/main.ts', 'logo.png']);
    expect(files.find((f) => f.path === 'apps/api/src/main.ts')?.content).toBe('export {};\n');
    expect(files.find((f) => f.path === 'logo.png')?.content).toBe('');
  });
});
