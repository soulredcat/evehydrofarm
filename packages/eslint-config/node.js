import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { sharedRules } from './rules.js';

/**
 * Preset untuk paket Node (App Pusat, db, contracts, tools).
 * @param {string} tsconfigRootDir folder paket pemakai (`import.meta.dirname`).
 */
export default function nodeConfig(tsconfigRootDir) {
  return defineConfig([
    globalIgnores(['dist/**', 'coverage/**', 'src/generated/**']),
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        globals: globals.node,
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: sharedRules,
    },
    {
      files: ['**/*.js', '**/*.mjs'],
      ...tseslint.configs.disableTypeChecked,
    },
  ]);
}
