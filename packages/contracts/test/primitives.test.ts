import { describe, expect, it } from 'vitest';
import {
  errorEnvelopeSchema,
  gramsSchema,
  idSchema,
  listQuerySchema,
  pageSchema,
  rupiahSchema,
} from '../src/index.ts';

describe('primitives', () => {
  it('menerima UUIDv7 dan menolak string acak', () => {
    expect(idSchema.safeParse('01a0d1c1-d372-7140-b696-71ff20ac4cf2').success).toBe(true);
    expect(idSchema.safeParse('bukan-uuid').success).toBe(false);
  });

  it('rupiah harus bilangan bulat non-negatif yang aman untuk JSON', () => {
    expect(rupiahSchema.safeParse(12_500).success).toBe(true);
    expect(rupiahSchema.safeParse(12.5).success).toBe(false);
    expect(rupiahSchema.safeParse(-1).success).toBe(false);
    expect(rupiahSchema.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
  });

  it('berat gram harus bilangan bulat positif', () => {
    expect(gramsSchema.safeParse(250).success).toBe(true);
    expect(gramsSchema.safeParse(0).success).toBe(false);
    expect(gramsSchema.safeParse(1.5).success).toBe(false);
  });

  it('query list memakai default 50 dan menolak limit > 200', () => {
    expect(listQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(listQuerySchema.parse({ limit: '20', cursor: 'abc' })).toEqual({
      limit: 20,
      cursor: 'abc',
    });
    expect(listQuerySchema.safeParse({ limit: 201 }).success).toBe(false);
  });

  it('halaman list berbentuk { items, nextCursor }', () => {
    const page = pageSchema(idSchema);
    expect(page.safeParse({ items: [], nextCursor: null }).success).toBe(true);
    expect(page.safeParse({ items: ['x'], nextCursor: null }).success).toBe(false);
  });

  it('amplop error hanya menerima kode yang terdaftar', () => {
    const ok = { error: { code: 'NOT_FOUND', message: 'Data tidak ditemukan.', requestId: 'r1' } };
    expect(errorEnvelopeSchema.safeParse(ok).success).toBe(true);
    const bad = { error: { code: 'OOPS', message: 'x', requestId: 'r1' } };
    expect(errorEnvelopeSchema.safeParse(bad).success).toBe(false);
  });
});
