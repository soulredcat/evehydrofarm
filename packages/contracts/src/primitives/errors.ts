import { z } from 'zod';

/** Kode error stabil App Pusat (05-api/00-konvensi.md §3). */
export const errorCodes = [
  'VALIDATION_FAILED',
  'CLOCK_INVALID',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'TOKEN_EXPIRED',
  'TOKEN_REUSED',
  'SCOPE_CHANGED',
  'USER_INACTIVE',
  'FORBIDDEN_ROLE',
  'FORBIDDEN_SCOPE',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'DUPLICATE_ID',
  'INSUFFICIENT_STOCK',
  'LOT_NOT_SELLABLE',
  'CYCLE_ALREADY_ACTIVE',
  'ALREADY_DECIDED',
  'USERNAME_TAKEN',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'BUSINESS_RULE',
  'RATE_LIMITED',
  'INTERNAL',
] as const;
export const errorCodeSchema = z.enum(errorCodes);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Amplop error tunggal untuk semua respons gagal. */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string().min(1),
    details: z.array(z.object({ path: z.string(), issue: z.string() })).optional(),
    reason: z.string().optional(),
    requestId: z.string().min(1),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
