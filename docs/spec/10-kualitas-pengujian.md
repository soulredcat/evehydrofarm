# 10 — Kualitas, Tooling & Pengujian

Semua perintah di sini dijalankan dari root repo di **Windows 11** (PowerShell atau cmd).
Skrip root harus berjalan di `cmd.exe` (pnpm di Windows) — tidak boleh bergantung pada bash.

## 1. Skrip root (`package.json`) — nama tetap

| Skrip | Isi |
|---|---|
| `dev:api` / `dev:web` / `dev:monitoring` | `pnpm --filter @eve/<app> dev` |
| `db:cluster` | cadangan: buat & jalankan cluster Postgres pribadi di luar repo (§3) |
| `db:setup` | buat role + database dev & test secara idempoten (butuh `DATABASE_ADMIN_URL`) |
| `db:migrate` | terapkan migrasi ke DB dev |
| `db:codegen` | `kysely-codegen` → `packages/db/src/generated/database.ts` |
| `db:seed` | seed dasar; `pnpm db:seed -- --demo` untuk data demo |
| `db:reset` | drop + buat ulang DB **dev** saja, migrate, seed demo (menolak jalan bila `DB_NAME` tidak berakhiran dev/`evehydrofarm`) |
| `api:keys` | buat pasangan kunci Ed25519, tulis ke `.env` bila `API_JWT_PRIVATE_KEY` kosong |
| `format` / `format:check` | Prettier (`--check` untuk verifikasi) + `dart format` / `dart format --set-exit-if-changed` untuk `apps/mobile` |
| `lint` | `pnpm -r lint` (ESLint, `--max-warnings 0`) |
| `typecheck` | `pnpm -r typecheck` (`tsc --noEmit`) |
| `check:repo` | `pnpm --filter @eve/repo-check start` (aturan `02-struktur-folder.md`) |
| `test` | `pnpm -r test` (Vitest: repo-check, contracts, db, api, monitoring) |
| `openapi:check` | export OpenAPI App Pusat lalu `git diff --exit-code apps/api/openapi.json` |
| `e2e` | Playwright web + monitoring (server dijalankan oleh `webServer` Playwright terhadap DB test) |
| `api:test-server` | reset DB test + seed demo, lalu jalankan App Pusat di port **4100** terhadap DB test (dipakai e2e & `mobile:it`) |
| `mobile:analyze` / `mobile:test` / `mobile:build` | `flutter analyze` / `flutter test --exclude-tags integration` / `flutter build apk --debug` di `apps/mobile` |
| `mobile:it` | `start-server-and-test` menjalankan `api:test-server`, menunggu `http://localhost:4100/health`, lalu `flutter test --tags integration --dart-define=API_BASE_URL=http://localhost:4100` (sync engine Flutter asli ↔ App Pusat asli) |
| `verify` | berurutan, berhenti di kegagalan pertama: `format:check` → `check:repo` → `lint` → `typecheck` → `test` → `openapi:check` → `e2e` → `mobile:analyze` → `mobile:test` → `mobile:it` → `mobile:build` |

`pnpm verify` lulus = syarat utama Definition of Done (`GOAL.md`).

## 2. Variabel lingkungan (`.env.example`, lengkap)

```text
DATABASE_ADMIN_URL=postgres://postgres:CHANGE_ME@localhost:5432/postgres
DB_HOST=localhost
DB_PORT=5432
DB_NAME=evehydrofarm
DB_TEST_NAME=evehydrofarm_test
DB_OWNER_PASSWORD=dev_owner_change_me
DB_API_PASSWORD=dev_api_change_me
DB_MONITORING_PASSWORD=dev_monitoring_change_me
DB_READONLY_PASSWORD=dev_readonly_change_me
API_PORT=4000
API_PUBLIC_URL=http://localhost:4000
API_JWT_PRIVATE_KEY=
API_JWT_PUBLIC_KEY=
API_STORAGE_DIR=
WEB_PORT=3000
WEB_API_URL=http://localhost:4000
MONITORING_PORT=3100
MONITORING_API_URL=http://localhost:4000
SEED_ADMIN_PASSWORD=admin-dev-12345
```

- Semua app memvalidasi env dengan Zod saat start; env wajib yang kosong → gagal start dengan pesan jelas.
- `API_STORAGE_DIR` kosong → default `<home>/.eve-hydrofarm/storage` (**di luar repo**).
- `.env` di-gitignore. Tidak ada rahasia di kode atau di commit.

## 3. Mode database lokal (cadangan bila `DATABASE_ADMIN_URL` tidak tersedia)

`pnpm db:cluster` (skrip TS di `packages/db/src/setup/`) membuat cluster PostgreSQL 18 pribadi di
`<home>/.eve-hydrofarm/pgdata` (di luar repo) memakai `initdb`/`pg_ctl` dari
`C:\Program Files\PostgreSQL\18\bin`, port `55433`, auth `scram-sha-256` dengan password dari `.env`,
lalu mencetak `DATABASE_ADMIN_URL` yang harus dipakai. Agen `/goal` memakai mode ini **hanya** bila
operator belum mengisi `DATABASE_ADMIN_URL`, dan mencatatnya di `docs/progress.md`.

## 4. Strategi test

| Lapisan | Alat | Lokasi | Wajib membuktikan |
|---|---|---|---|
| Aturan repo | Vitest | `tools/repo-check/test/` | tiap aturan menolak contoh pelanggaran & menerima contoh sah |
| Kontrak | Vitest | `packages/contracts/test/` | skema menerima contoh sah, menolak contoh salah; enum sama dengan `CHECK` di DB |
| Database | Vitest + DB test nyata | `packages/db/test/` | migrasi dari nol, checksum, semua invarian `04-database/*`, serangan RLS `03-peran-akses.md` §6 dijalankan **sebagai `eve_api`** |
| App Pusat | Vitest + Fastify `inject` + DB test nyata | `apps/api/test/` | setiap endpoint: sukses, validasi gagal, 401, 403, scope lain = 404; test sinkron `06-sinkronisasi.md` §9 |
| Monitoring | Vitest + DB test | `apps/monitoring/test/` | ingest, dedupe, evaluasi ambang, buka/tutup alert, auth perangkat, verifikasi JWT via JWKS |
| Website | Playwright | `apps/web/e2e/` | alur di `07-website/` bagian "Alur e2e" |
| Monitoring UI | Playwright | `apps/monitoring/e2e/` | alur di `09-monitoring/` bagian "Alur e2e" |
| Mobile | `flutter_test` + `mocktail` + drift in-memory | `apps/mobile/test/` | alur di `08-mobile/` bagian "Test wajib" |
| Mobile ↔ Pusat | `flutter_test` tag `integration` + App Pusat nyata (port 4100) | `apps/mobile/test/integration/` | login, registrasi perangkat, bootstrap pull, push panen+jual, pull ulang melihat baris server, idempoten saat push diulang |

Aturan test:
- **Tidak ada mock database** di test DB/API/Monitoring: selalu Postgres nyata (`DB_TEST_NAME`).
  Vitest `globalSetup`: drop & buat ulang schema test, migrate, seed dasar. Tiap file test membuat fixture sendiri
  dengan kode unik (boleh paralel).
- Test tidak boleh bergantung pada urutan file atau jam dinding (pakai jam yang diinjeksi).
- Tidak ada `test.skip`/`it.only`/`@Skip` yang di-commit. `repo-check` menolak pola ini.
- Cakupan baris minimal **70%** untuk `apps/api/src/modules/**` (Vitest coverage v8, gagal di bawahnya).
- Setiap bug yang diperbaiki mendapat test yang gagal sebelum perbaikan.

## 5. Gaya kode

- TypeScript `strict`, `noUncheckedIndexedAccess`, tanpa `any` eksplisit (ESLint `no-explicit-any: error`),
  tanpa `// @ts-ignore` (pakai `@ts-expect-error` + alasan bila benar-benar perlu).
- ESLint: `typescript-eslint` recommended-type-checked, `import/no-cycle`, larangan impor lintas app
  (`no-restricted-imports`), `max-lines` **tidak** dipakai (LOC ditegakkan `repo-check`).
- Prettier: `printWidth 100`, `singleQuote`, `trailingComma all`, `semi true`.
- Dart: `flutter_lints` + `analysis_options.yaml` dengan `strict-casts`, `strict-raw-types`; `flutter analyze` tanpa issue.
- Tidak ada `console.log` di kode produksi (pakai logger `pino` di API; di Next.js hanya di server dan lewat logger kecil).
- Komentar menjelaskan **kenapa**, bukan apa. Setiap `mod`/folder fitur punya ringkasan kontrak di file utama
  (doc comment di `index.ts` modul API, di `<fitur>_repository.dart` mobile).

## 6. Log progres `/goal`

`docs/progress.md` diperbarui di akhir **setiap milestone** (bukan di akhir saja):

```text
## M3 — App Pusat — 2026-10-02 — SELESAI | SEBAGIAN | GAGAL
Dikerjakan: ...
TIDAK dikerjakan / sisa: ...
Verifikasi (output asli, ekor 20 baris per perintah):
$ pnpm --filter @eve/api test
...
Commit: <hash> <pesan>
```

- Angka (jumlah test, durasi, cakupan) hanya boleh ditulis bila berasal dari output perintah yang benar-benar dijalankan.
- Status `SELESAI` hanya boleh ditulis bila **semua** perintah verifikasi milestone itu lulus pada run terakhir.
- Pertanyaan untuk operator ditulis di bagian `## Pertanyaan untuk operator` — agen lanjut ke pekerjaan lain yang tidak terblokir.
