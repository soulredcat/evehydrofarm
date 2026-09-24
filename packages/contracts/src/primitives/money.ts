import { z } from 'zod';

/** Uang dalam rupiah utuh (K-06). Dibatasi ke bilangan bulat aman JSON (< 2^53). */
export const rupiahSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export type Rupiah = z.infer<typeof rupiahSchema>;
