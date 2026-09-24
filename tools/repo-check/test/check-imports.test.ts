import { describe, expect, it } from 'vitest';
import { checkImports, importSpecifiers } from '../src/check-imports.ts';

// Teks impor dirakit dari potongan supaya file test ini sendiri tidak berisi impor lintas app.
const imp = (specifier: string) => ['imp', 'ort { x } fr', 'om ', `'${specifier}';`].join('');
const file = (path: string, ...specifiers: string[]) => ({
  path,
  content: specifiers.map(imp).join('\n'),
});
const rulesOf = (files: ReturnType<typeof file>[]) =>
  checkImports(files).map((v) => `${v.rule} ${v.path}`);

describe('importSpecifiers', () => {
  it('menangkap impor statis, side-effect, dinamis, require, dan export-from', () => {
    const content = [
      imp('a'),
      ['imp', "ort './globals.css';"].join(''),
      ['const m = await imp', "ort('c');"].join(''),
      ['const n = req', "uire('d');"].join(''),
      ['exp', 'ort { y } fr', "om 'e';"].join(''),
    ].join('\n');
    expect(importSpecifiers(content).sort()).toEqual(['./globals.css', 'a', 'c', 'd', 'e']);
  });
});

describe('checkImports', () => {
  it('Website tidak boleh mengimpor database (K-11)', () => {
    expect(
      rulesOf([file('apps/web/src/server/api-client.ts', '@eve/db', 'pg', 'kysely/helpers')]),
    ).toEqual([
      'forbidden-import apps/web/src/server/api-client.ts',
      'forbidden-import apps/web/src/server/api-client.ts',
      'forbidden-import apps/web/src/server/api-client.ts',
    ]);
  });

  it('Monitoring & App Pusat boleh memakai @eve/db dan @eve/contracts', () => {
    expect(
      rulesOf([
        file(
          'apps/monitoring/src/features/alerts/server/alerts.repo.ts',
          '@eve/db',
          '@eve/contracts',
        ),
      ]),
    ).toEqual([]);
    expect(rulesOf([file('apps/api/src/app.ts', '@eve/db', './config/env.ts')])).toEqual([]);
  });

  it('app tidak saling impor, lewat nama paket maupun path relatif', () => {
    expect(
      rulesOf([
        file('apps/web/src/server/api-client.ts', '@eve/api'),
        file('apps/web/src/server/session.ts', '../../../api/src/app.ts'),
        file('apps/monitoring/src/app/page.tsx', '@eve/web/src/ui/button'),
      ]),
    ).toEqual([
      'cross-app-import apps/web/src/server/api-client.ts',
      'cross-app-import apps/web/src/server/session.ts',
      'cross-app-import apps/monitoring/src/app/page.tsx',
    ]);
  });

  it('packages dan tools tidak boleh bergantung pada app atau keluar dari foldernya', () => {
    expect(
      rulesOf([
        file('packages/contracts/src/index.ts', '@eve/api'),
        file('packages/db/src/index.ts', '../../contracts/src/index.ts'),
        file('packages/db/src/client/create-db.ts', '../migrate/plan-migrations.ts'),
      ]),
    ).toEqual([
      'cross-app-import packages/contracts/src/index.ts',
      'cross-app-import packages/db/src/index.ts',
    ]);
  });

  it('impor relatif Dart di dalam apps/mobile sah; keluar dari app ditolak', () => {
    expect(
      rulesOf([file('apps/mobile/lib/app/app.dart', '../features/auth/screens/login_screen.dart')]),
    ).toEqual([]);
    expect(rulesOf([file('apps/mobile/lib/app/app.dart', '../../../api/src/app.ts')])).toEqual([
      'cross-app-import apps/mobile/lib/app/app.dart',
    ]);
  });
});
