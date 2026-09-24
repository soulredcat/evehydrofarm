import { z } from 'zod';

/** Berat dalam gram, bilangan bulat positif (K-06). */
export const gramsSchema = z.number().int().positive().max(2_147_483_647);
export type Grams = z.infer<typeof gramsSchema>;
