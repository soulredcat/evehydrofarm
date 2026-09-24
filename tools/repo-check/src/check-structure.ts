import {
  FORBIDDEN_NAME_EXCEPTIONS,
  FORBIDDEN_NAMES,
  MAX_FILES_PER_FOLDER,
  README_MAX_LINES,
  ROOT_ENTRIES,
  TOP_LEVEL_CHILDREN,
  isExcluded,
  lineCount,
  type RepoFile,
  type Violation,
} from './rules.ts';

const README_AT_PACKAGE_ROOT = /^(apps|packages|tools)\/[^/]+\/README\.md$/;

/** Nama tanpa ekstensi dan tanpa tanda kurung grup rute Next.js, huruf kecil. */
function bareName(segment: string): string {
  const withoutGroup = segment.replace(/^\((.*)\)$/, '$1');
  const dot = withoutGroup.indexOf('.', 1);
  return (dot > 0 ? withoutGroup.slice(0, dot) : withoutGroup).toLowerCase();
}

function checkLayout(path: string): Violation[] {
  const [top, child] = path.split('/');
  if (top === undefined || !ROOT_ENTRIES.has(top)) {
    return [{ rule: 'root-layout', path, message: `"${top}" tidak ada di pohon root §1.` }];
  }
  const allowedChildren = TOP_LEVEL_CHILDREN[top];
  if (allowedChildren && (child === undefined || !allowedChildren.has(child))) {
    return [
      { rule: 'top-level-layout', path, message: `"${top}/${child}" tidak ada di pohon §1.` },
    ];
  }
  return [];
}

function checkNames(path: string): Violation[] {
  const segments = path.split('/');
  const violations: Violation[] = [];
  segments.forEach((segment, index) => {
    const prefix = segments.slice(0, index + 1).join('/');
    if (FORBIDDEN_NAME_EXCEPTIONS.has(prefix)) return;
    if (FORBIDDEN_NAMES.has(bareName(segment))) {
      violations.push({
        rule: 'forbidden-name',
        path,
        message: `Nama "${segment}" terlarang (§8.1). Beri nama sesuai tanggung jawabnya.`,
      });
    }
  });
  return violations;
}

function checkDocs(file: RepoFile): Violation[] {
  const { path } = file;
  if (!path.endsWith('.md')) return [];
  if (README_AT_PACKAGE_ROOT.test(path)) {
    const lines = lineCount(file.content);
    return lines > README_MAX_LINES
      ? [{ rule: 'readme-size', path, message: `${lines} baris, README maks ${README_MAX_LINES}.` }]
      : [];
  }
  const insideSource = path.split('/').includes('src') || path.startsWith('apps/mobile/lib/');
  return insideSource
    ? [{ rule: 'doc-location', path, message: 'File .md dilarang di dalam src/ atau lib/ (§8.3).' }]
    : [];
}

/** §1, §8.1–§8.3: pohon root, nama terlarang, maks file per folder, lokasi dokumen. */
export function checkStructure(files: RepoFile[]): Violation[] {
  const violations: Violation[] = [];
  const perFolder = new Map<string, number>();
  for (const file of files) {
    violations.push(...checkLayout(file.path));
    if (isExcluded(file.path)) continue;
    violations.push(...checkNames(file.path), ...checkDocs(file));
    const folder = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '.';
    perFolder.set(folder, (perFolder.get(folder) ?? 0) + 1);
  }
  for (const [folder, count] of perFolder) {
    if (count > MAX_FILES_PER_FOLDER) {
      violations.push({
        rule: 'folder-size',
        path: folder,
        message: `${count} file, maks ${MAX_FILES_PER_FOLDER} (§8.2). Pecah jadi subfolder bermakna.`,
      });
    }
  }
  return dedupe(violations);
}

function dedupe(violations: Violation[]): Violation[] {
  const seen = new Set<string>();
  return violations.filter((violation) => {
    const key = `${violation.rule}|${violation.path}|${violation.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
