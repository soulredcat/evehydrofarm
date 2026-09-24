import { createHash } from 'node:crypto';

/** File migrasi `NNNN_nama.sql` yang sudah dibaca dari disk. */
export interface MigrationFile {
  version: string;
  name: string;
  sql: string;
}

/** Baris `meta.schema_migration` yang sudah diterapkan. */
export interface AppliedMigration {
  version: string;
  checksum: string;
}

export interface MigrationPlan {
  pending: MigrationFile[];
  errors: string[];
}

const FILE_NAME = /^(\d{4})_([a-z0-9_]+)\.sql$/;

/** Mengurai nama file migrasi; `null` bila nama tidak mengikuti `NNNN_snake_case.sql`. */
export function parseMigrationFileName(fileName: string): { version: string; name: string } | null {
  const match = FILE_NAME.exec(fileName);
  if (!match?.[1] || !match[2]) return null;
  return { version: match[1], name: match[2] };
}

/**
 * Checksum SHA-256 isi migrasi. Akhir baris dinormalkan ke LF supaya checkout Windows (CRLF)
 * tidak dianggap mengubah migrasi yang sudah diterapkan.
 */
export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/**
 * Menentukan migrasi yang harus dijalankan. Gagal (errors tidak kosong) bila: versi ganda, migrasi yang
 * sudah diterapkan hilang atau isinya berubah, atau ada file baru bernomor di bawah versi terakhir yang diterapkan.
 */
export function planMigrations(files: MigrationFile[], applied: AppliedMigration[]): MigrationPlan {
  const errors: string[] = [];
  const sorted = [...files].sort((a, b) => a.version.localeCompare(b.version));
  const byVersion = new Map<string, MigrationFile>();
  for (const file of sorted) {
    if (byVersion.has(file.version)) errors.push(`Versi migrasi ganda: ${file.version}`);
    byVersion.set(file.version, file);
  }
  const appliedVersions = new Set<string>();
  for (const row of applied) {
    appliedVersions.add(row.version);
    const file = byVersion.get(row.version);
    if (!file) errors.push(`Migrasi ${row.version} sudah diterapkan tetapi filenya tidak ada`);
    else if (checksumOf(file.sql) !== row.checksum) {
      errors.push(
        `Checksum migrasi ${row.version} berubah; migrasi tidak boleh diedit, buat file baru`,
      );
    }
  }
  const lastApplied = [...appliedVersions].sort().at(-1);
  const pending = sorted.filter((file) => !appliedVersions.has(file.version));
  for (const file of pending) {
    if (lastApplied !== undefined && file.version < lastApplied) {
      errors.push(
        `Migrasi ${file.version} bernomor di bawah versi terakhir yang diterapkan (${lastApplied})`,
      );
    }
  }
  return { pending: errors.length ? [] : pending, errors };
}
