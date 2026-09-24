import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

/**
 * Membuat klien Kysely di atas pool `pg`.
 * Tipe `Database` diisi dari `src/generated/database.ts` (kysely-codegen) mulai M1.
 */
export function createDb<Database>(
  connectionString: string,
  maxConnections = 10,
): Kysely<Database> {
  const pool = new pg.Pool({ connectionString, max: maxConnections });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
