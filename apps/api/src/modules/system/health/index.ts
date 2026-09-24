/**
 * Modul `system/health` — `GET /health` (05-api/00-konvensi.md §8).
 * Kontrak: selalu 200 bila proses hidup. Status kerangka: `checks.database` bernilai `not-configured`
 * sampai plugin database ada (M3); saat itu health wajib benar-benar menguji koneksi DB.
 */
export { healthRoutes as healthModule } from './health.routes.ts';
