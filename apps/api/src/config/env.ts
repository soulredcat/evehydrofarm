import { z } from 'zod';

/**
 * Env App Pusat (10-kualitas-pengujian.md §2), divalidasi saat start.
 * Status: kerangka — variabel database, JWT, dan storage ditambahkan bersama plugin-nya di M3.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  API_PUBLIC_URL: z.url().default('http://localhost:4000'),
});

export type ApiEnv = z.infer<typeof envSchema>;

/** Membaca env; gagal dengan daftar variabel yang salah, bukan dengan nilai default diam-diam. */
export function loadEnv(source: Record<string, string | undefined>): ApiEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Env App Pusat tidak valid:\n${issues.join('\n')}`);
  }
  return parsed.data;
}
