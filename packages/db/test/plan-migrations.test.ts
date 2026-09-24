import { describe, expect, it } from 'vitest';
import { checksumOf, parseMigrationFileName, planMigrations } from '../src/index.ts';

const file = (version: string, sql = `-- ${version}`) => ({ version, name: `m${version}`, sql });
const applied = (version: string, sql = `-- ${version}`) => ({
  version,
  checksum: checksumOf(sql),
});

describe('parseMigrationFileName', () => {
  it('menerima NNNN_snake_case.sql dan menolak nama lain', () => {
    expect(parseMigrationFileName('0004_core.sql')).toEqual({ version: '0004', name: 'core' });
    expect(parseMigrationFileName('4_core.sql')).toBeNull();
    expect(parseMigrationFileName('0004-Core.sql')).toBeNull();
    expect(parseMigrationFileName('0004_core.txt')).toBeNull();
  });
});

describe('checksumOf', () => {
  it('sama untuk LF dan CRLF, beda bila isi berubah', () => {
    expect(checksumOf('a\r\nb')).toBe(checksumOf('a\nb'));
    expect(checksumOf('a\nb')).not.toBe(checksumOf('a\nc'));
  });
});

describe('planMigrations', () => {
  it('DB kosong: semua file pending, urut versi', () => {
    const plan = planMigrations([file('0002'), file('0001')], []);
    expect(plan.errors).toEqual([]);
    expect(plan.pending.map((m) => m.version)).toEqual(['0001', '0002']);
  });

  it('hanya menjalankan yang belum diterapkan', () => {
    const plan = planMigrations([file('0001'), file('0002')], [applied('0001')]);
    expect(plan.errors).toEqual([]);
    expect(plan.pending.map((m) => m.version)).toEqual(['0002']);
  });

  it('gagal bila migrasi yang sudah diterapkan diedit', () => {
    const plan = planMigrations([file('0001', '-- diubah')], [applied('0001')]);
    expect(plan.pending).toEqual([]);
    expect(plan.errors[0]).toContain('Checksum migrasi 0001 berubah');
  });

  it('gagal bila file migrasi yang sudah diterapkan hilang', () => {
    const plan = planMigrations([], [{ version: '0001', checksum: 'x' }]);
    expect(plan.errors[0]).toContain('filenya tidak ada');
  });

  it('gagal bila ada versi ganda atau file baru di bawah versi terakhir', () => {
    expect(planMigrations([file('0001'), file('0001')], []).errors[0]).toContain('ganda');
    const plan = planMigrations([file('0001'), file('0002')], [applied('0002')]);
    expect(plan.errors[0]).toContain('di bawah versi terakhir');
  });
});
