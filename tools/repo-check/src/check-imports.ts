import { posix } from 'node:path';
import {
  APP_PACKAGES,
  FORBIDDEN_IMPORTS,
  extensionOf,
  isExcluded,
  type RepoFile,
  type Violation,
} from './rules.ts';

const SCRIPT_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.dart'];
const SPECIFIER_PATTERNS = [
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g,
  /import\s*['"]([^'"]+)['"]/g,
  /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  /require\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** Semua specifier impor di satu file (TS/JS/Dart). */
export function importSpecifiers(content: string): string[] {
  const found = new Set<string>();
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) found.add(match[1]);
    }
  }
  return [...found];
}

/** `apps/<nama>/` pemilik file, atau `null` bila file bukan milik app. */
function owningApp(path: string): string | null {
  const [top, app] = path.split('/');
  return top === 'apps' && app ? app : null;
}

function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

function checkSpecifier(path: string, specifier: string): Violation | null {
  const app = owningApp(path);
  if (specifier.startsWith('.')) {
    const target = posix.normalize(posix.join(posix.dirname(path), specifier));
    const home = app ? `apps/${app}/` : `${path.split('/').slice(0, 2).join('/')}/`;
    if (!target.startsWith(home)) {
      return {
        rule: 'cross-app-import',
        path,
        message: `Impor relatif "${specifier}" keluar dari ${home}. Berbagi kode hanya lewat packages/* (§8.6).`,
      };
    }
    return null;
  }
  const name = packageName(specifier);
  if (APP_PACKAGES.includes(name) && name !== `@eve/${app}`) {
    return {
      rule: 'cross-app-import',
      path,
      message: `Impor "${name}" dilarang: app tidak saling impor (§8.6).`,
    };
  }
  if (app && FORBIDDEN_IMPORTS[app]?.includes(name)) {
    return {
      rule: 'forbidden-import',
      path,
      message: `Impor "${name}" dilarang untuk apps/${app} (K-11).`,
    };
  }
  return null;
}

/** §8.6 + K-11: tidak ada impor lintas app, Website tidak menyentuh database. */
export function checkImports(files: RepoFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    if (isExcluded(file.path) || !SCRIPT_EXTENSIONS.includes(extensionOf(file.path))) continue;
    for (const specifier of importSpecifiers(file.content)) {
      if (specifier.startsWith('package:') || specifier.startsWith('dart:')) continue;
      const violation = checkSpecifier(file.path, specifier);
      if (violation) violations.push(violation);
    }
  }
  return violations;
}
