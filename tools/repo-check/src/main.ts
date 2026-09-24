import { resolve } from 'node:path';
import { checkImports } from './check-imports.ts';
import { checkLoc } from './check-loc.ts';
import { checkMarkers } from './check-markers.ts';
import { checkStructure } from './check-structure.ts';
import type { Violation } from './rules.ts';
import { listRepoFiles } from './walk-files.ts';

/** Menjalankan semua aturan 02-struktur-folder.md terhadap repo; exit 1 bila ada pelanggaran. */
function main(): number {
  const root = resolve(import.meta.dirname, '..', '..', '..');
  const files = listRepoFiles(root);
  const violations: Violation[] = [
    ...checkStructure(files),
    ...checkLoc(files),
    ...checkImports(files),
    ...checkMarkers(files),
  ];
  for (const violation of violations) {
    process.stdout.write(`✗ [${violation.rule}] ${violation.path} — ${violation.message}\n`);
  }
  process.stdout.write(
    `repo-check: ${files.length} file diperiksa, ${violations.length} pelanggaran.\n`,
  );
  return violations.length === 0 ? 0 : 1;
}

process.exitCode = main();
