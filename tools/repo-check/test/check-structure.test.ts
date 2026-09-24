import { describe, expect, it } from 'vitest';
import { checkStructure } from '../src/check-structure.ts';
import type { RepoFile } from '../src/rules.ts';

const file = (path: string, content = ''): RepoFile => ({ path, content });
const rulesOf = (files: RepoFile[]) => checkStructure(files).map((v) => `${v.rule} ${v.path}`);

describe('checkStructure', () => {
  it('pohon yang sah tidak menghasilkan pelanggaran', () => {
    expect(
      rulesOf([
        file('GOAL.md'),
        file('package.json'),
        file('pnpm-lock.yaml'),
        file('apps/api/src/main.ts'),
        file('apps/mobile/lib/main.dart'),
        file('packages/db/src/index.ts'),
        file('tools/repo-check/src/main.ts'),
        file('docs/spec/00-keputusan-asumsi.md'),
        file('docs/progress.md'),
        file('apps/web/README.md', 'x\n'.repeat(80)),
      ]),
    ).toEqual([]);
  });

  it('menolak file/folder root di luar §1', () => {
    expect(rulesOf([file('notes.txt'), file('scripts/build.ts')])).toEqual([
      'root-layout notes.txt',
      'root-layout scripts/build.ts',
    ]);
  });

  it('menolak anak folder tingkat atas yang tidak terdaftar', () => {
    expect(rulesOf([file('apps/admin/src/main.ts'), file('docs/notes/a.md')])).toEqual([
      'top-level-layout apps/admin/src/main.ts',
      'top-level-layout docs/notes/a.md',
    ]);
  });

  it('menolak nama terlarang untuk folder, file, dan grup rute', () => {
    const found = rulesOf([
      file('apps/web/src/utils/format.ts'),
      file('apps/api/src/helpers.ts'),
      file('apps/web/src/app/(shared)/page.tsx'),
      file('packages/db/src/lib/x.ts'),
      file('apps/api/src/modules/sales/Common/x.ts'),
    ]);
    expect(found).toEqual([
      'forbidden-name apps/web/src/utils/format.ts',
      'forbidden-name apps/api/src/helpers.ts',
      'forbidden-name apps/web/src/app/(shared)/page.tsx',
      'forbidden-name packages/db/src/lib/x.ts',
      'forbidden-name apps/api/src/modules/sales/Common/x.ts',
    ]);
  });

  it('mengizinkan hanya apps/mobile/lib sebagai folder lib', () => {
    expect(rulesOf([file('apps/mobile/lib/app/app.dart')])).toEqual([]);
    expect(rulesOf([file('apps/mobile/lib/features/lib/x.dart')])).toEqual([
      'forbidden-name apps/mobile/lib/features/lib/x.dart',
    ]);
  });

  it('menolak folder berisi lebih dari 12 file, mengabaikan folder platform Flutter', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => file(`apps/web/src/ui/c${i}.tsx`));
    expect(rulesOf(twelve)).toEqual([]);
    expect(rulesOf([...twelve, file('apps/web/src/ui/c12.tsx')])).toEqual([
      'folder-size apps/web/src/ui',
    ]);
    const android = Array.from({ length: 30 }, (_, i) => file(`apps/mobile/android/app/f${i}.xml`));
    expect(rulesOf(android)).toEqual([]);
  });

  it('menolak .md di dalam src/ atau lib/, dan README > 80 baris', () => {
    expect(
      rulesOf([
        file('apps/api/src/modules/NOTES.md'),
        file('apps/mobile/lib/features/README.md'),
        file('packages/db/README.md', 'x\n'.repeat(81)),
      ]),
    ).toEqual([
      'doc-location apps/api/src/modules/NOTES.md',
      'doc-location apps/mobile/lib/features/README.md',
      'readme-size packages/db/README.md',
    ]);
  });
});
