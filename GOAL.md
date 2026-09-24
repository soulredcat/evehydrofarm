# GOAL — Eve Hydrofarm (Smart Greenhouse Hidroponik NFT)

> Titik masuk `/goal`. Bangun seluruh sistem di `docs/spec/` sampai **semua milestone M0–M9 berstatus SELESAI**
> di `docs/progress.md` dan **`pnpm verify` lulus (exit 0) dalam satu run** yang outputnya dikutip di sana.

## Cara menjalankan

<!-- CARA_MENJALANKAN -->

## Misi

Sistem untuk perusahaan dengan **banyak farm** greenhouse hidroponik **NFT** (cabai, tomat, sayur daun):

| Aplikasi | Folder | Pengguna |
|---|---|---|
| App Pusat (backend TS, satu-satunya sumber kebenaran) | `apps/api` | semua aplikasi lain |
| Website (publik + dashboard) | `apps/web` | publik, ADMIN, SUPERVISOR, SELLER |
| Mobile Flutter offline-first, sinkron ke App Pusat | `apps/mobile` | WORKER, SELLER, SUPERVISOR |
| Monitoring sensor greenhouse (app terpisah) | `apps/monitoring` | ADMIN, SUPERVISOR, WORKER |
| Database PostgreSQL 18, dipecah per schema | `packages/db` | App Pusat, Monitoring |

Aturan bisnis inti: **1 worker = 1 greenhouse**, **1 supervisor = 1 farm**, worker boleh menjual dari stok
greenhouse-nya dengan mencatat **blok, meja, dan pembeli**; akses ditegakkan di App Pusat **dan** RLS Postgres.

## Urutan baca (wajib, sebelum menulis kode)

| # | Dokumen | Isi |
|---|---|---|
| 1 | `docs/spec/00-keputusan-asumsi.md` | keputusan terkunci K-xx, risiko R-xx, di luar cakupan |
| 2 | `docs/spec/01-arsitektur.md` | aplikasi, stack, auth, role DB |
| 3 | `docs/spec/02-struktur-folder.md` | **struktur folder & LOC 200/300/400 — MUTLAK** |
| 4 | `docs/spec/03-peran-akses.md` | peran, scope, matriks aksi, test akses wajib |
| 5 | `docs/spec/04-database/00..14` | konvensi + DDL lengkap + seed |
| 6 | `docs/spec/05-api/00..05` | konvensi API + semua endpoint |
| 7 | `docs/spec/06-sinkronisasi.md` | protokol pull/push mobile |
| 8 | `docs/spec/07-website/`, `08-mobile/`, `09-monitoring/` | spesifikasi tiap aplikasi |
| 9 | `docs/spec/10-kualitas-pengujian.md` | skrip, env, strategi test, format progres |

Prioritas bila dua dokumen bertentangan: `00` > `02` > `03` > `04-database` > `06` > `05-api` > `07/08/09` > `10`.

## Aturan kerja (mutlak)

1. **Jangan mengubah keputusan terkunci** (K-xx, R-xx). Jika spesifikasi kontradiktif atau mustahil:
   pilih tafsiran yang paling aman bagi data & akses, catat di `docs/progress.md` → `## Pertanyaan untuk operator`, lanjutkan.
2. **Struktur folder & batas LOC adalah syarat selesai**, bukan kosmetik. `pnpm check:repo` wajib lulus di setiap milestone.
3. **Jangan pernah melaporkan sesuatu berhasil tanpa melihatnya berhasil.** Jumlah test, hasil, durasi = kutipan output asli.
4. Setiap perubahan datang bersama test yang mengunci invariannya. Jangan mematikan, melewati, atau melemahkan
   test/lint/aturan untuk membuat sesuatu lulus. Perbaiki **akar masalah**.
5. Tidak ada `TODO`, stub, atau data palsu di kode yang dinyatakan selesai. Yang belum dikerjakan ditulis sebagai
   "TIDAK dikerjakan" di progres.
6. **Commit lokal di akhir setiap milestone** (`feat(mN): ...`), setelah verifikasi milestone lulus. **Jangan push.**
7. Tidak ada rahasia di commit (`.env`, kunci, password). Password dev hanya di `.env.example`/dokumen seed.
8. Hanya sentuh database `evehydrofarm` dan `evehydrofarm_test` (plus cluster cadangan `db:cluster`). Jangan
   mengubah konfigurasi service Postgres operator. Jangan memasang software sistem global selain dependency proyek
   (pnpm, `flutter pub`) dan browser Playwright (`pnpm exec playwright install chromium`).
9. Bahasa: TypeScript untuk semua kode non-mobile, Dart untuk mobile. Tidak ada bahasa lain di repo.
10. Jika satu milestone terblokir hal di luar kendali (mis. jaringan), catat buktinya, kerjakan milestone lain yang
    tidak bergantung padanya, lalu kembali.

## Prasyarat

- `.env` diisi operator dari `.env.example` (`10-kualitas-pengujian.md` §2). Jika `DATABASE_ADMIN_URL` kosong atau
  gagal konek, pakai mode cadangan `pnpm db:cluster` (§3 dokumen yang sama) dan catat di progres.
- Tooling terpasang: Node 22.22, pnpm 10.13, PostgreSQL 18, Flutter 3.41.4 / Dart 3.11.1, Android SDK, Java 17, Chrome.

## Milestone

Setiap milestone selesai = semua kriteria tercentang + semua perintah verifikasinya lulus + progres ditulis + commit.

### M0 — Fondasi monorepo
- [ ] Pohon root persis `02-struktur-folder.md` §1; `pnpm-workspace.yaml`, preset `@eve/tsconfig`, `@eve/eslint-config`, Prettier, `.editorconfig`, `.gitignore`, `.gitattributes` (LF), `.env.example` lengkap.
- [ ] `tools/repo-check` lengkap (LOC, nama terlarang, maks 12 file/folder, root, impor lintas app, `.skip/.only`) + test tiap aturan.
- [ ] Semua skrip root `10-kualitas-pengujian.md` §1 ada (yang belum punya target boleh gagal jelas "belum diimplementasi" hanya sampai milestone pemiliknya).
- [ ] `README.md` singkat + `docs/progress.md` dibuat.
- Verifikasi: `pnpm install`, `pnpm format:check`, `pnpm check:repo`, `pnpm lint`, `pnpm typecheck`, `pnpm --filter @eve/repo-check test`.

### M1 — Database (`packages/db`)
- [ ] `db:setup`, `db:cluster`, `db:migrate` (checksum), `db:codegen`, `db:seed [--demo]`, `db:reset`.
- [ ] Migrasi `0001..0014` = DDL `04-database/01..13` apa adanya; seed sesuai `14-seed.md`.
- [ ] Test DB: migrasi dari nol, checksum berubah → gagal, semua invarian tiap dokumen `04-database`, **7 test akses `03-peran-akses.md` §6 sebagai `eve_api`**.
- Verifikasi: `pnpm db:setup`, `pnpm db:reset`, `pnpm db:codegen` lalu `git diff --exit-code packages/db/src/generated`, `pnpm --filter @eve/db test`.

### M2 — Kontrak (`packages/contracts`)
- [ ] Skema Zod untuk setiap request/response `05-api/*` dan setiap tipe mutasi `06-sinkronisasi.md` §4.3; enum = `CHECK` DB.
- Verifikasi: `pnpm --filter @eve/contracts test`, `pnpm typecheck`.

### M3 — App Pusat inti
- [ ] Plugin (`database`, `authenticate`, `request-scope`, `error-handler`, `openapi`, `rate-limit`, `cors`), env, `iam/*`, `core/*`, `agro/catalog`, `inventory/products`, `sales/price-lists`, `sales/customers`, `system/health`, JWKS.
- [ ] Test per endpoint (sukses, 400, 401, 403, 404 scope lain) + test token (rotasi, reuse → cabut keluarga, `SCOPE_CHANGED`).
- Verifikasi: `pnpm --filter @eve/api test`, `pnpm openapi:check`.

### M4 — App Pusat operasi, stok, penjualan, laporan
- [ ] `agro/*` (siklus, kegiatan, cek air, tugas, masalah, panen), `inventory/*`, `sales/sales`, `sales/sale-voids`, `reports/*`, `files/attachments`, `site/*`, `audit/audit-logs`.
- [ ] Aturan R-01..R-06 dibuktikan test; CSV laporan; cakupan ≥ 70% `src/modules/**`.
- Verifikasi: `pnpm --filter @eve/api test -- --coverage`, `pnpm openapi:check`.

### M5 — Sinkronisasi (App Pusat)
- [ ] `sync/devices`, `sync/pull` (algoritma `06` §3.2 persis), `sync/push` (registry semua tipe mutasi §4.3, idempoten).
- [ ] 10 test wajib `06-sinkronisasi.md` §9, termasuk celah urutan commit dengan dua koneksi nyata.
- Verifikasi: `pnpm --filter @eve/api test`.

### M6 — Website (`apps/web`)
- [ ] Semua halaman `07-website/*`, BFF cookie `httpOnly`, gating peran (worker ditolak), format Rupiah/berat/tanggal WIB.
- [ ] Semua alur e2e `07-website/` lulus di Playwright terhadap `api:test-server`.
- Verifikasi: `pnpm --filter @eve/web build`, `pnpm e2e`.

### M7 — Mobile (`apps/mobile`)
- [ ] Semua layar per peran `08-mobile/*`, DB lokal drift, outbox, sync engine `06`, Pusat Sinkron, penomoran offline.
- [ ] Test wajib `08-mobile/` + integrasi nyata ke App Pusat (`mobile:it`).
- Verifikasi: `pnpm mobile:analyze`, `pnpm mobile:test`, `pnpm mobile:it`, `pnpm mobile:build`.

### M8 — Monitoring (`apps/monitoring`)
- [ ] Ingest `X-Device-Key`, ambang, alert, UI, auth via JWKS App Pusat, simulator sensor `09-monitoring/*`.
- [ ] Test Vitest + alur e2e monitoring.
- Verifikasi: `pnpm --filter @eve/monitoring test`, `pnpm --filter @eve/monitoring build`, `pnpm e2e`.

### M9 — Penutup
- [ ] `pnpm verify` lulus dalam satu run; ekor output tiap langkah dikutip di progres.
- [ ] `README.md` final: setup, `.env`, menjalankan 4 aplikasi + simulator, akun demo.
- [ ] `docs/progress.md`: semua M0–M9 `SELESAI`, daftar "TIDAK dikerjakan" hanya berisi hal di luar cakupan `00` §Di luar cakupan.
- [ ] `git status` bersih; satu commit per milestone.

## Definition of Done (global)

Semua benar **pada saat yang sama**, dibuktikan output asli di `docs/progress.md`:
1. `pnpm verify` exit 0 (mencakup format, repo-check, lint, typecheck, semua test, OpenAPI, e2e, mobile analyze/test/it/build).
2. `pnpm db:reset` dari nol lulus (migrasi + seed demo).
3. `pnpm check:repo` 0 pelanggaran: struktur folder persis `02`, tidak ada file > batas LOC.
4. Tidak ada `TODO`/`FIXME`/`test.skip`/`it.only` di kode yang di-commit.
5. Milestone M0–M9 `SELESAI`; setiap milestone punya commit lokal; tidak ada push.
