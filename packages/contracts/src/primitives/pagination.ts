import { z } from 'zod';

/** Query list berbasis cursor (05-api/00-konvensi.md §4). */
export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

/** Bentuk halaman list: `{ items, nextCursor }`. */
export function pageSchema<Item extends z.ZodType>(item: Item) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}
