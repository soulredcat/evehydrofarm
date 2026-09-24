import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import { sharedRules } from './rules.js';

/**
 * Preset untuk aplikasi Next.js (Website, Monitoring).
 * @param {string[]} forbiddenImports paket yang tidak boleh diimpor aplikasi ini.
 */
export default function nextConfig(forbiddenImports = []) {
  return defineConfig([
    ...nextVitals,
    ...nextTs,
    globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'playwright-report/**']),
    {
      rules: {
        ...sharedRules,
        'no-restricted-imports': [
          'error',
          {
            paths: forbiddenImports.map((name) => ({
              name,
              message: 'Dilarang untuk aplikasi ini (01-arsitektur.md).',
            })),
          },
        ],
      },
    },
  ]);
}
