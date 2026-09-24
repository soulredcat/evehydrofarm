# Eve Hydrofarm

Sistem smart greenhouse hidroponik **NFT** untuk banyak farm: App Pusat (backend), Website,
Mobile Flutter offline-first (worker, seller, supervisor), dan Monitoring sensor, di atas PostgreSQL 18.

> **Status: kerangka (skeleton).** Struktur folder, tooling, dan kerangka keempat aplikasi sudah berjalan.
> Fitur dibangun per milestone M0–M9 di [`GOAL.md`](GOAL.md). Progres nyata: [`docs/progress.md`](docs/progress.md).

## Struktur

| Folder                                        | Isi                                             |
| --------------------------------------------- | ----------------------------------------------- |
| `apps/api`                                    | App Pusat — Fastify + Zod + Kysely (TypeScript) |
| `apps/web`                                    | Website — Next.js (publik + dashboard)          |
| `apps/mobile`                                 | Mobile — Flutter + drift (offline-first)        |
| `apps/monitoring`                             | Monitoring sensor — Next.js (app terpisah)      |
| `packages/contracts`                          | Skema Zod bersama                               |
| `packages/db`                                 | Migrasi SQL, setup, seed, klien Kysely          |
| `packages/eslint-config`, `packages/tsconfig` | Preset tooling                                  |
| `tools/repo-check`                            | Penegak aturan folder & batas baris 200/300/400 |
| `docs/spec`                                   | Spesifikasi lengkap                             |

Aturan struktur folder bersifat **mutlak**: [`docs/spec/02-struktur-folder.md`](docs/spec/02-struktur-folder.md).

## Prasyarat

Node 22.22, pnpm 10.13, PostgreSQL 18, Flutter 3.41.4 (Dart 3.11.1), Android SDK, Java 17.
Salin `.env.example` → `.env` dan isi `DATABASE_ADMIN_URL`.

## Perintah yang sudah berjalan

```bash
pnpm install
pnpm check:repo
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @eve/web build
pnpm dev:api
```

Mobile: `pnpm mobile:analyze`, `pnpm mobile:test`, `pnpm mobile:build`.
Perintah lain (`db:*`, `e2e`, `openapi:check`, `mobile:it`) sengaja gagal dengan pesan
"belum diimplementasi (Mx)" sampai milestone pemiliknya selesai.
