# 01 — Arsitektur Sistem

## Gambaran

```text
                        ┌──────────────────────────────┐
  Browser publik ─────▶ │  WEBSITE  apps/web  :3000    │──┐
  Admin/Supervisor/     │  Next.js (publik + dashboard)│  │ HTTP (JSON, Bearer JWT)
  Seller (web)          └──────────────────────────────┘  │
                                                          ▼
  HP Worker/Seller/     ┌──────────────────────────────┐ ┌──────────────────────────────┐
  Supervisor ─────────▶ │  MOBILE  apps/mobile         │▶│  APP PUSAT  apps/api  :4000  │
  (offline-first)       │  Flutter + SQLite (drift)    │ │  Fastify + Kysely            │
                        │  outbox → push / pull ◀──────│ │  auth, bisnis, sync, laporan │
                        └──────────────────────────────┘ └──────────────┬───────────────┘
                                                                         │ role eve_api (RLS)
  Sensor ESP32 ──HTTP──▶┌──────────────────────────────┐                ▼
  (atau simulator)      │  MONITORING apps/monitoring  │   ┌──────────────────────────┐
  Browser monitoring ──▶│  Next.js :3100 (UI + ingest) │──▶│ PostgreSQL 18            │
                        └──────────────────────────────┘   │ db: evehydrofarm         │
                           role eve_monitoring             │ schema: meta iam core    │
                           (rw monitoring, ro core)        │ agro inventory sales     │
                                                           │ files site sync audit    │
                                                           │ monitoring               │
                                                           └──────────────────────────┘
```

## Tanggung jawab tiap aplikasi

| Aplikasi | Boleh | Tidak boleh |
|---|---|---|
| `apps/api` (App Pusat) | Semua logika bisnis, auth & token, RLS context, sync server, laporan, upload file, JWKS publik. | Merender HTML. Menulis schema `monitoring`. |
| `apps/web` (Website) | Render halaman, form, tabel, grafik; memanggil API dari server (RSC / server action / route handler BFF). Menyimpan token di cookie `httpOnly`. | Import `pg`/`kysely`/`packages/db`. Logika bisnis (hitung stok, validasi PHI, dsb). |
| `apps/mobile` (Flutter) | UI peran worker/seller/supervisor, DB lokal, outbox, sync, validasi lokal untuk UX. | Menjadi sumber kebenaran. Mengubah data master. |
| `apps/monitoring` | Ingest pembacaan sensor, evaluasi ambang, alert, UI grafik; verifikasi JWT dari App Pusat via JWKS. | Menulis schema selain `monitoring`. Membuat token login sendiri. |

## Paket bersama (TypeScript)

| Paket | Isi | Dipakai oleh |
|---|---|---|
| `packages/db` | Migrasi SQL (sumber kebenaran skema), runner migrasi, setup role/database, seed, tipe Kysely hasil `kysely-codegen`. | api, monitoring, tools |
| `packages/contracts` | Skema **Zod** request/response API + enum domain + kode error. Satu-satunya definisi bentuk data lintas aplikasi TS. | api, web, monitoring |
| `packages/tsconfig` | Preset `tsconfig` bersama. | semua paket TS |
| `packages/eslint-config` | Preset ESLint flat config bersama. | semua paket TS |

Flutter tidak bisa memakai Zod; kontrak untuk mobile = **OpenAPI** yang di-generate App Pusat
(`GET /openapi.json`, juga ditulis ke `apps/api/openapi.json` oleh `pnpm --filter @eve/api openapi:export`).
DTO Dart ditulis tangan mengikuti file itu; test kontrak di mobile memvalidasi contoh JSON.

## Stack & versi acuan (diverifikasi di mesin operator, 2026-09-24)

Versi di bawah sudah dicek resolusinya (npm/pub) di mesin ini. **Pin persis** di `package.json` / `pubspec.yaml`
(tanpa `^` untuk baris bertanda 📌); lockfile di-commit. Naik major = keputusan operator.

| Bagian | Paket & versi |
|---|---|
| Runtime | Node 22.22, pnpm 10.13, 📌 **TypeScript 6.0.3** (TS 7.x = compiler Go tanpa API JS; `typescript-eslint` butuh `<6.1`) |
| App Pusat | Fastify 5.12, `fastify-type-provider-zod` 7.0 + **Zod 4.6** (provider v7 tidak mendukung Zod 3), `@fastify/swagger` 9.9, `@fastify/swagger-ui` 6.1, `@fastify/multipart` 10.1, `@fastify/rate-limit` 11.2, `@fastify/cors` 11.3, Kysely 0.29 + `pg` 8.23, `jose` 6.2 (JWT EdDSA), `@node-rs/argon2` 2.2 (biner win32 siap pakai), `pino` 10 |
| Modul | **ESM di semua paket TS** (`"type": "module"`, `moduleResolution: NodeNext`) — Kysely & jose hanya ESM |
| Database | PostgreSQL 18, migrasi **SQL tulisan tangan**, `kysely-codegen` 0.20 **tanpa** `--default-schema` (kunci tabel `'core.farm'`), `--numeric-parser string` |
| Website & Monitoring | Next.js 16.3, React/React-DOM 19.3 (+ `react-is` 19.3 untuk Recharts), Tailwind CSS 4.3 + `@tailwindcss/postcss` 4.3, Radix UI, TanStack Table 9, React Hook Form 7 + `@hookform/resolvers` 5, Recharts 3 |
| Lint/format | 📌 **ESLint 9.39.5** di seluruh monorepo (plugin `eslint-config-next` 16 belum mendukung ESLint 10), `typescript-eslint` 8.70, Prettier 3.9 |
| Mobile | Flutter 3.41.4 / Dart 3.11.1. 📌 `flutter_riverpod` 3.3.2, 📌 `go_router` 17.5.0, 📌 `drift` 2.34.4 + 📌 `drift_dev` 2.34.0, 📌 `sqlite3` 3.5.2 (**tanpa** `sqlite3_flutter_libs` — sudah EOL; hook `sqlite3` mengunduh SQLite otomatis, butuh internet saat build/test pertama), 📌 `build_runner` 2.15.1, `dio` 5.11, `flutter_secure_storage` 11.2, `connectivity_plus` 7.3, `image_picker` 1.2, `uuid` 4.6, 📌 `intl` 0.20.2 (dipin `flutter_localizations`), `path_provider` 2.1, `mocktail` 1.0.5 |
| Nota mobile | `share_plus`, `pdf`, paket ESC/POS + Bluetooth thermal — versi dipilih & dicek resolusinya di `08-mobile/` |
| Test | Vitest 5, Playwright 1.63, `flutter_test` + `mocktail` (terbukti: drift `NativeDatabase.memory()` lulus `flutter test` di Windows ini) |
| Kualitas | ESLint, Prettier, `dart format`, `flutter analyze`, `tools/repo-check` (LOC + struktur) |

## Autentikasi lintas aplikasi

1. App Pusat menandatangani **access token JWT** (EdDSA/Ed25519, 15 menit) berisi
   `sub` (user id), `role`, `farmId`, `greenhouseId`, `scopeVersion`.
2. **Refresh token** opak (32 byte acak), disimpan **hash**-nya di `iam.refresh_token`, masa 30 hari,
   dirotasi setiap dipakai; pemakaian ulang token lama → seluruh keluarga token dicabut.
3. Website: login lewat route handler BFF `apps/web` → cookie `httpOnly; Secure; SameSite=Lax`.
   Browser tidak pernah melihat token di JavaScript.
4. Mobile: token di `flutter_secure_storage`. Offline tetap bisa bekerja dengan sesi terakhir;
   push/pull menunggu sampai token berhasil diperbarui.
5. Monitoring: memverifikasi access token dengan kunci publik dari `GET /.well-known/jwks.json`
   milik App Pusat (cache 10 menit). Login monitoring = form yang meneruskan ke `POST /v1/auth/login` App Pusat.
6. Perangkat sensor tidak memakai JWT: header `X-Device-Key` (hash disimpan di `monitoring.device`).

## Aliran data utama

- **Panen → Stok**: panen di meja X blok Y membuat 1 `inventory.lot` + 1 pergerakan `HARVEST_IN`.
- **Stok → Jual**: tiap baris jual menunjuk 1 lot ⇒ asal **meja & blok** selalu tertelusur (K-24).
- **Pestisida → PHI**: kegiatan semprot mengisi `agro.planting_cycle.harvest_blocked_until`.
- **Mobile ↔ Pusat**: outbox → `POST /v1/sync/push`; `GET /v1/sync/pull?cursor=` → upsert lokal.
- **Sensor → Monitoring**: `POST /api/ingest` → `monitoring.reading` → evaluasi ambang → `monitoring.alert`.

## Port & URL lokal

| Aplikasi | URL |
|---|---|
| App Pusat | `http://localhost:4000` (OpenAPI UI di `/docs`) |
| Website | `http://localhost:3000` |
| Monitoring | `http://localhost:3100` |
| Mobile → API (emulator Android) | `http://10.0.2.2:4000` (dikonfigurasi lewat `--dart-define=API_BASE_URL=`) |

## Database & role Postgres

| Role | Dipakai oleh | Hak |
|---|---|---|
| `eve_owner` | migrasi & seed | pemilik semua objek (LOGIN, hanya dipakai oleh `db:migrate` & `db:seed`) |
| `eve_api` | App Pusat | CRUD di schema bisnis, **RLS berlaku** (`NOBYPASSRLS`), tidak punya hak DDL |
| `eve_monitoring` | Monitoring | CRUD `monitoring.*`, `SELECT` terbatas `core.*` & `iam.user_account(id, full_name, role)`; RLS berlaku. Tidak punya grant apa pun di schema bisnis lain — konteks RLS yang ia set sendiri tidak bisa membuka data di luar grant-nya |
| `eve_readonly` | laporan/debug manual oleh operator (tidak dipakai aplikasi) | `SELECT` saja, `BYPASSRLS` (baca penuh, sadar dan disengaja), tanpa kolom rahasia (`password_hash`, `token_hash`, `device_key_hash`) |

Database `evehydrofarm` (dev) dan `evehydrofarm_test` (test, dibuat ulang oleh test runner).
`pnpm db:setup` (butuh `DATABASE_ADMIN_URL`) membuat role + database secara idempoten.
Semua tabel bisnis memakai `FORCE ROW LEVEL SECURITY`. Detail di `04-database/`.

## Hal yang sengaja tidak dilakukan

- Tidak ada message broker, Redis, queue, atau cron: semua status turunan dihitung saat baca
  (mis. perangkat sensor "offline" = `last_seen_at` lebih tua dari 10 menit).
- Tidak ada microservice tambahan di luar empat aplikasi di atas.
