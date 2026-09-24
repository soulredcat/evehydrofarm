import { z } from 'zod';

/** ID entitas: UUID (UUIDv7 bila dibuat klien, K-31). */
export const idSchema = z.uuid();
export type Id = z.infer<typeof idSchema>;
