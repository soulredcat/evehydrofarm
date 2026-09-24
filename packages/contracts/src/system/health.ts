import { z } from 'zod';

/** Respons `GET /health`. `database` = `not-configured` hanya selama kerangka (sebelum M3). */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('api'),
  checks: z.object({
    database: z.enum(['ok', 'not-configured']),
  }),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
