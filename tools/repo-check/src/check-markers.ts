import {
  CODE_EXTENSIONS,
  extensionOf,
  isExcluded,
  type RepoFile,
  type Violation,
} from './rules.ts';

// Pola dirakit dari potongan supaya file ini sendiri tidak memicu aturannya.
const WORK_MARKER = new RegExp(`\\b(${['TO', 'DO'].join('')}|${['FIX', 'ME'].join('')})\\b`);
const SKIP = ['sk', 'ip'].join('');
// `.only`, `.skip`, `.skipIf`, `.todo` di Vitest/Playwright, dan opsi `{ skip: ... }`.
const TS_FOCUS = new RegExp(
  `\\b(?:it|test|describe)\\.(?:${['on', 'ly'].join('')}|${SKIP}(?:If)?|${['to', 'do'].join('')})\\s*\\(|\\b${SKIP}\\s*:`,
);
// Dart: argumen bernama `skip:` apa pun (termasuk bersyarat) menonaktifkan test.
const DART_SKIP = new RegExp(`\\b${SKIP}\\s*:`);

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.tsx?$/.test(path) || path.endsWith('_test.dart');
}

/** DoD #4 + 10-kualitas §4: tidak ada penanda kerja tertunda dan tidak ada test yang dilewati/difokuskan. */
export function checkMarkers(files: RepoFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    if (isExcluded(file.path) || !CODE_EXTENSIONS.includes(extensionOf(file.path))) continue;
    file.content.split('\n').forEach((text, index) => {
      const where = `${file.path}:${index + 1}`;
      if (WORK_MARKER.test(text)) {
        violations.push({
          rule: 'work-marker',
          path: where,
          message: 'Penanda kerja tertunda di kode yang di-commit.',
        });
      }
      if (isTestFile(file.path) && (TS_FOCUS.test(text) || DART_SKIP.test(text))) {
        violations.push({
          rule: 'test-focus',
          path: where,
          message: 'Test dilewati/difokuskan dilarang di-commit.',
        });
      }
    });
  }
  return violations;
}
