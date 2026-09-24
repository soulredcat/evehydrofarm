import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COUNTED_EXTENSIONS, extensionOf, type RepoFile } from './rules.ts';

/**
 * Daftar file repo menurut git: yang dilacak + yang baru tetapi tidak di-ignore.
 * Dengan begitu `node_modules`, `.next`, `.env`, dsb. otomatis tidak ikut diperiksa.
 * Isi hanya dibaca untuk ekstensi yang diperiksa (§9); file lain berisi string kosong.
 */
export function listRepoFiles(root: string): RepoFile[] {
  const output = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
  );
  const paths = [...new Set(output.split('\0').filter((path) => path.length > 0))].sort();
  const files: RepoFile[] = [];
  for (const path of paths) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) continue;
    const content = COUNTED_EXTENSIONS.includes(extensionOf(path))
      ? readFileSync(absolute, 'utf8')
      : '';
    files.push({ path, content });
  }
  return files;
}
