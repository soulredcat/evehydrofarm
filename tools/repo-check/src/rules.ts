/**
 * Aturan tunggal repo-check. Isi file ini = docs/spec/02-struktur-folder.md §1, §8, §9, §10.
 * Mengubah aturan di sini tanpa mengubah dokumen itu (atau sebaliknya) adalah pelanggaran.
 */

/** File repo: path relatif root dengan pemisah `/`, beserta isinya (kosong untuk ekstensi tak diperiksa). */
export interface RepoFile {
  path: string;
  content: string;
}

export type RuleId =
  | 'loc'
  | 'forbidden-name'
  | 'folder-size'
  | 'doc-location'
  | 'readme-size'
  | 'root-layout'
  | 'top-level-layout'
  | 'cross-app-import'
  | 'forbidden-import'
  | 'test-focus'
  | 'work-marker';

export interface Violation {
  rule: RuleId;
  path: string;
  message: string;
}

/** Ekstensi yang dihitung LOC-nya dan diperiksa isinya (§9). */
export const COUNTED_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.dart',
  '.sql',
  '.md',
  '.css',
];

/** Ekstensi kode (untuk pemeriksaan penanda kerja & fokus test). */
export const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.dart', '.sql'];

/** Hasil generate / platform Flutter: tidak dihitung LOC, jumlah file, maupun nama. */
export const EXCLUDED_PREFIXES = [
  'apps/mobile/android/',
  'apps/mobile/ios/',
  'packages/db/src/generated/',
];
export const GENERATED_SUFFIXES = ['.g.dart', '.freezed.dart'];

/** Isi root yang sah (§1). */
export const ROOT_ENTRIES = new Set([
  'GOAL.md',
  'README.md',
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  '.editorconfig',
  '.gitignore',
  '.gitattributes',
  '.prettierrc.json',
  '.prettierignore',
  '.env.example',
  'apps',
  'packages',
  'tools',
  'docs',
]);

/** Anak sah dari folder tingkat atas (§1). */
export const TOP_LEVEL_CHILDREN: Record<string, Set<string>> = {
  apps: new Set(['api', 'web', 'mobile', 'monitoring']),
  packages: new Set(['contracts', 'db', 'eslint-config', 'tsconfig']),
  tools: new Set(['repo-check']),
  docs: new Set(['spec', 'progress.md']),
};

/** Nama folder/file terlarang (§8.1), dibandingkan tanpa huruf besar/kecil. */
export const FORBIDDEN_NAMES = new Set([
  'utils',
  'util',
  'helpers',
  'helper',
  'misc',
  'common',
  'shared',
  'stuff',
  'temp',
  'tmp',
  'old',
  'new',
  'backup',
  'copy',
  'lib',
]);
/** Satu-satunya pengecualian nama terlarang: folder `lib` wajib Flutter. */
export const FORBIDDEN_NAME_EXCEPTIONS = new Set(['apps/mobile/lib']);

export const MAX_FILES_PER_FOLDER = 12;
export const README_MAX_LINES = 80;

/** Paket aplikasi — tidak boleh diimpor oleh app lain maupun oleh packages/tools (§8.6). */
export const APP_PACKAGES = ['@eve/api', '@eve/web', '@eve/monitoring', '@eve/mobile'];
/** Impor terlarang per app (K-11: Website tidak mengakses database). */
export const FORBIDDEN_IMPORTS: Record<string, string[]> = {
  web: ['@eve/db', 'pg', 'kysely'],
};

const TEST_FILE = [/\.test\.tsx?$/, /\.spec\.tsx?$/, /_test\.dart$/];
const TIER_200 = [
  /\.tsx$/,
  /\.routes\.ts$/,
  /\.policy\.ts$/,
  /\.mapper\.ts$/,
  /(^|\/)index\.ts$/,
  /(^|\/)middleware\.ts$/,
  /(^|\/)main\.(ts|dart)$/,
  /\.config\.(ts|js|mjs|cjs)$/,
  /^apps\/(web|monitoring)\/src\/app\//,
  /^apps\/mobile\/lib\/app\//,
  /^apps\/mobile\/lib\/ui_kit\//,
  /^apps\/mobile\/lib\/.*\/(screens|widgets)\//,
];
const TIER_300 = [
  /\.service\.ts$/,
  /\.repo\.ts$/,
  /\/server\//,
  /^apps\/api\/src\/plugins\//,
  /^packages\/contracts\//,
  /^packages\/db\/src\//,
  /^tools\//,
  /^apps\/monitoring\/simulator\//,
  /^apps\/mobile\/lib\/data\//,
  /_repository\.dart$/,
  /_providers\.dart$/,
];

export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}

export function isExcluded(path: string): boolean {
  return (
    EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
    GENERATED_SUFFIXES.some((suffix) => path.endsWith(suffix))
  );
}

/** Batas LOC untuk satu file (§9), atau `null` bila file tidak dihitung. */
export function locLimitFor(path: string): 200 | 300 | 400 | null {
  if (isExcluded(path) || !COUNTED_EXTENSIONS.includes(extensionOf(path))) return null;
  if (TEST_FILE.some((re) => re.test(path))) return 400;
  if (TIER_200.some((re) => re.test(path))) return 200;
  if (TIER_300.some((re) => re.test(path))) return 300;
  return 400;
}

/** Jumlah baris fisik seperti `wc -l` plus baris terakhir tanpa newline. */
export function lineCount(content: string): number {
  if (content === '') return 0;
  const lines = content.split('\n').length;
  return content.endsWith('\n') ? lines - 1 : lines;
}
