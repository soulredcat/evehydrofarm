import { describe, expect, it } from 'vitest';
import { checkLoc } from '../src/check-loc.ts';
import { lineCount, locLimitFor } from '../src/rules.ts';

const lines = (count: number) => 'x\n'.repeat(count);

describe('locLimitFor — tabel §9', () => {
  it.each([
    ['apps/web/src/features/sales/components/sale-form.tsx', 200],
    ['apps/api/src/modules/agro/harvests/harvests.routes.ts', 200],
    ['apps/api/src/modules/agro/harvests/harvests.policy.ts', 200],
    ['apps/api/src/modules/agro/harvests/index.ts', 200],
    ['apps/web/src/middleware.ts', 200],
    ['apps/web/src/app/(publik)/page.tsx', 200],
    ['apps/monitoring/src/app/api/ingest/route.ts', 200],
    ['apps/api/src/main.ts', 200],
    ['apps/mobile/lib/main.dart', 200],
    ['apps/mobile/lib/app/router.dart', 200],
    ['apps/mobile/lib/features/sales/screens/sale_screen.dart', 200],
    ['apps/mobile/lib/ui_kit/rupiah_text.dart', 200],
    ['apps/web/next.config.ts', 200],
    ['apps/api/src/modules/agro/harvests/harvests.service.ts', 300],
    ['apps/api/src/modules/agro/harvests/harvests.repo.ts', 300],
    ['apps/web/src/features/sales/server/queries.ts', 300],
    ['apps/api/src/plugins/request-scope.ts', 300],
    ['packages/contracts/src/sales/sale.ts', 300],
    ['packages/db/src/migrate/run-migrations.ts', 300],
    ['tools/repo-check/src/rules.ts', 300],
    ['apps/mobile/lib/data/sync/pull_runner.dart', 300],
    ['apps/mobile/lib/features/sales/sales_repository.dart', 300],
    ['packages/db/migrations/0004_core.sql', 400],
    ['apps/api/test/agro/harvests/create.test.ts', 400],
    ['apps/web/e2e/seller-sale.spec.ts', 400],
    ['apps/mobile/test/data/outbox_test.dart', 400],
    ['docs/spec/00-keputusan-asumsi.md', 400],
    ['apps/web/src/app/globals.css', 200],
  ] as const)('%s → %i', (path, limit) => {
    expect(locLimitFor(path)).toBe(limit);
  });

  it.each([
    'apps/mobile/android/app/src/main/kotlin/MainActivity.kt',
    'apps/mobile/ios/Runner/AppDelegate.swift',
    'packages/db/src/generated/database.ts',
    'apps/mobile/lib/data/local/app_database.g.dart',
    'apps/web/public/logo.png',
    'pnpm-lock.yaml',
    'apps/api/openapi.json',
  ])('%s tidak dihitung', (path) => {
    expect(locLimitFor(path)).toBeNull();
  });
});

describe('lineCount', () => {
  it('menghitung seperti wc -l, termasuk baris terakhir tanpa newline', () => {
    expect(lineCount('')).toBe(0);
    expect(lineCount('a')).toBe(1);
    expect(lineCount('a\n')).toBe(1);
    expect(lineCount('a\n\nb')).toBe(3);
  });
});

describe('checkLoc', () => {
  it('menolak file yang melewati batas dan menerima yang tepat di batas', () => {
    const violations = checkLoc([
      { path: 'apps/web/src/ui/button.tsx', content: lines(200) },
      { path: 'apps/web/src/ui/dialog.tsx', content: lines(201) },
      { path: 'apps/api/src/modules/sales/sales/sales.service.ts', content: lines(301) },
      { path: 'packages/db/migrations/0009_sales.sql', content: lines(401) },
      { path: 'apps/mobile/android/app/build.gradle.kts', content: lines(900) },
    ]);
    expect(violations.map((v) => v.path)).toEqual([
      'apps/web/src/ui/dialog.tsx',
      'apps/api/src/modules/sales/sales/sales.service.ts',
      'packages/db/migrations/0009_sales.sql',
    ]);
    expect(violations[0]?.message).toContain('201 baris, batas 200');
  });
});
