/**
 * Aturan bersama semua paket TypeScript Eve Hydrofarm.
 * Batas baris file TIDAK diatur di sini: ditegakkan oleh tools/repo-check (02-struktur-folder.md §9).
 */
export const sharedRules = {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/consistent-type-imports': 'error',
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  'no-console': 'error',
  eqeqeq: ['error', 'always'],
};
