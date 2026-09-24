# App Pusat (`@eve/api`)

Backend TypeScript: satu-satunya pemilik logika bisnis, auth, dan server sinkronisasi (K-10).

**Status: kerangka.** Baru ada `GET /health` (modul `system/health`), 404 beramplop error, dan
validasi env. Plugin database/auth/RLS dan semua modul domain dibangun di M3–M5 (`GOAL.md`).
`checks.database` di `/health` bernilai `not-configured` sampai plugin database ada.

## Struktur

`src/main.ts` (start) · `src/app.ts` (rakit Fastify) · `src/config/env.ts` · `src/modules/<domain>/<modul>/`
· `test/` mencerminkan `src/`. Aturan: `docs/spec/02-struktur-folder.md` §2, `docs/spec/05-api/`.

## Perintah

| Perintah                                    | Isi                                                    |
| ------------------------------------------- | ------------------------------------------------------ |
| `pnpm --filter @eve/api dev`                | jalankan dengan reload (port `API_PORT`, default 4000) |
| `pnpm --filter @eve/api test`               | Vitest                                                 |
| `pnpm --filter @eve/api lint` / `typecheck` | ESLint / tsc                                           |
