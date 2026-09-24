import { lineCount, locLimitFor, type RepoFile, type Violation } from './rules.ts';

/** §9: setiap file yang dihitung tidak boleh melebihi batas 200/300/400 baris. */
export function checkLoc(files: RepoFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const limit = locLimitFor(file.path);
    if (limit === null) continue;
    const lines = lineCount(file.content);
    if (lines > limit) {
      violations.push({
        rule: 'loc',
        path: file.path,
        message: `${lines} baris, batas ${limit}. Pecah berdasarkan tanggung jawab, jangan dipadatkan.`,
      });
    }
  }
  return violations;
}
