import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.ts';

describe('loadEnv', () => {
  it('memakai default lokal bila variabel kosong', () => {
    expect(loadEnv({})).toEqual({
      NODE_ENV: 'development',
      API_PORT: 4000,
      API_PUBLIC_URL: 'http://localhost:4000',
    });
  });

  it('membaca port dari string env', () => {
    expect(loadEnv({ API_PORT: '4100' }).API_PORT).toBe(4100);
  });

  it('gagal dengan pesan yang menyebut variabelnya', () => {
    expect(() => loadEnv({ API_PORT: 'abc' })).toThrow(/API_PORT/);
    expect(() => loadEnv({ API_PUBLIC_URL: 'bukan url' })).toThrow(/API_PUBLIC_URL/);
  });
});
