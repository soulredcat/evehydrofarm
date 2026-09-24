import { describe, expect, it } from 'vitest';
import { checkMarkers } from '../src/check-markers.ts';

// Penanda dirakit dari potongan supaya file test ini sendiri tidak memicu aturan.
const todo = ['TO', 'DO'].join('');
const fixme = ['FIX', 'ME'].join('');
const only = ['on', 'ly'].join('');
const skip = ['sk', 'ip'].join('');

const rulesOf = (path: string, content: string) =>
  checkMarkers([{ path, content }]).map((v) => `${v.rule} ${v.path}`);

describe('checkMarkers', () => {
  it('menolak penanda kerja tertunda di kode', () => {
    expect(rulesOf('apps/api/src/app.ts', `const a = 1;\n// ${todo}: nanti`)).toEqual([
      'work-marker apps/api/src/app.ts:2',
    ]);
    expect(rulesOf('apps/mobile/lib/main.dart', `// ${fixme} rusak`)).toEqual([
      'work-marker apps/mobile/lib/main.dart:1',
    ]);
  });

  it('tidak memeriksa dokumen', () => {
    expect(rulesOf('docs/spec/00-keputusan-asumsi.md', `${todo} di dokumen boleh`)).toEqual([]);
  });

  it('menolak test yang difokuskan atau dilewati (TS & Dart)', () => {
    expect(rulesOf('apps/api/test/a.test.ts', `it.${only}('x', () => {});`)).toEqual([
      'test-focus apps/api/test/a.test.ts:1',
    ]);
    expect(rulesOf('apps/web/e2e/a.spec.ts', `test.${skip}('x', async () => {});`)).toEqual([
      'test-focus apps/web/e2e/a.spec.ts:1',
    ]);
    expect(rulesOf('apps/mobile/test/a_test.dart', `test('x', () {}, ${skip}: true);`)).toEqual([
      'test-focus apps/mobile/test/a_test.dart:1',
    ]);
  });

  it('menolak skip bersyarat Dart, skipIf/todo Vitest, dan opsi skip di objek', () => {
    const dart = `test('x', () {}, ${skip}: const bool.hasEnvironment('A') ? 'alasan' : false);`;
    expect(rulesOf('apps/mobile/test/b_test.dart', dart)).toEqual([
      'test-focus apps/mobile/test/b_test.dart:1',
    ]);
    const ts = [
      `it.${skip}If(process.env.CI)('x', () => {});`,
      `it.${['to', 'do'].join('')}('nanti');`,
      `test('x', { ${skip}: true }, () => {});`,
    ].join('\n');
    expect(rulesOf('apps/api/test/c.test.ts', ts)).toEqual([
      'test-focus apps/api/test/c.test.ts:1',
      'test-focus apps/api/test/c.test.ts:2',
      'test-focus apps/api/test/c.test.ts:3',
    ]);
  });

  it('pola fokus di luar file test tidak dipermasalahkan', () => {
    expect(rulesOf('apps/api/src/app.ts', `const list = items.${only}Visible;`)).toEqual([]);
  });
});
