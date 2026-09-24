# GOAL — Eve Hydrofarm (Smart Greenhouse Hidroponik NFT)

> Titik masuk `/goal`. Bangun seluruh sistem di `docs/spec/` sampai **semua milestone M0–M9 berstatus SELESAI**
> di `docs/progress.md` dan **`pnpm verify` lulus (exit 0) dalam satu run** yang outputnya dikutip di sana.

## Cara menjalankan

`/goal` dinilai oleh model kecil yang **hanya membaca transkrip percakapan** — ia tidak menjalankan perintah dan
tidak membaca file. Karena itu setiap giliran agen wajib **menampilkan** bukti (output perintah asli), dan kondisi
ditulis sebagai sesuatu yang terlihat di output. Batas kondisi: 4.000 karakter. Jalankan dengan mode izin otomatis
supaya giliran tidak berhenti menunggu izin tiap perintah.

**Disarankan: satu milestone per `/goal`** (pekerjaan penuh sangat besar; konteks yang meluap menghentikan goal).
Ganti `M1` dengan milestone yang dituju, urut M0 → M9:

```text
/goal Milestone M1 di GOAL.md selesai: semua kriteria M1 tercentang di docs/progress.md dengan status SELESAI; di giliran terakhir kamu menjalankan ulang SEMUA perintah verifikasi M1 plus `pnpm check:repo`, semuanya exit 0, dan menampilkan ekor output asli masing-masing; ada commit lokal "feat(m1): ..." dan `git status --porcelain` kosong. Ikuti GOAL.md dan docs/spec apa adanya: jangan ubah keputusan K-xx/R-xx, jangan push, jangan melemahkan/melewati test atau lint, jangan kerjakan milestone lain. Jika terblokir hal yang hanya bisa diselesaikan operator, tulis buktinya di docs/progress.md dan nyatakan goal mustahil beserta alasannya. Berhenti setelah 60 giliran.
```

Sekali jalan untuk semuanya (hanya jika konteks & kuota cukup):

```text
/goal Semua milestone M0–M9 di GOAL.md berstatus SELESAI di docs/progress.md; di giliran terakhir kamu menjalankan `pnpm verify` (exit 0) dan `pnpm db:reset` (exit 0) serta menampilkan ekor output asli tiap langkah; `pnpm check:repo` 0 pelanggaran; `git log --oneline` menunjukkan satu commit per milestone; `git status --porcelain` kosong. Jangan ubah keputusan K-xx/R-xx, jangan push, jangan melemahkan test/lint. Jika terblokir hal yang hanya bisa diselesaikan operator, tulis buktinya di docs/progress.md dan nyatakan goal mustahil beserta alasannya.
```

## Misi

Sistem untuk perusahaan dengan **banyak farm** greenhouse hidroponik **NFT** (cabai, tomat, sayur daun):

| Aplikasi | Folder | Pengguna |
|---|---|---|
| App Pusat (backend TS, satu-satunya sumber kebenaran) | `apps/api` | semua aplikasi lain |
| Website (publik + dashboard) | `apps/web` | publik, ADMIN, SUPERVISOR, SELLER |
| Mobile Flutter offline-first, sinkron ke App Pusat | `apps/mobile` | WORKER, SELLER, SUPERVISOR |
| Monitoring sensor greenhouse (app terpisah) | `apps/monitoring` | ADMIN, SUPERVISOR, WORKER |
| Database PostgreSQL 18, dipecah per schema | `packages/db` | App Pusat, Monitoring |

Aturan bisnis inti: **1 worker = 1 greenhouse**, **1 supervisor = 1 farm**, **seller = 1 farm**; worker boleh
menjual dari stok greenhouse-nya dengan mencatat **blok, meja, dan pembeli**; akses ditegakkan di App Pusat
**dan** RLS Postgres. Fitur: satuan jual kg/ikat/pack/pcs, pesanan (pre-order), nota WhatsApp/PDF/printer
Bluetooth, stok bahan + biaya → HPP & laba per siklus/meja.

## Urutan baca (wajib, sebelum menulis kode)

| # | Dokumen | Isi |
|---|---|---|
| 1 | `docs/spec/00-keputusan-asumsi.md` | keputusan terkunci K-xx, risiko R-xx, di luar cakupan |
| 2 | `docs/spec/01-arsitektur.md` | aplikasi, stack & versi terpin, auth, role DB |
| 3 | `docs/spec/02-struktur-folder.md` | **struktur folder & LOC 200/300/400 — MUTLAK** |
| 4 | `docs/spec/03-peran-akses.md` | peran, scope, matriks aksi, test akses wajib |
| 5 | `docs/spec/04-database/00..17` | konvensi + DDL lengkap per schema + seed |
| 6 | `docs/spec/05-api/00..07` | konvensi API + semua endpoint |
| 7 | `docs/spec/06-sinkronisasi.md` | protokol pull/push mobile |
| 8 | `docs/spec/07-website/`, `08-mobile/`, `09-monitoring/` | spesifikasi tiap aplikasi |
| 9 | `docs/spec/10-kualitas-pengujian.md` | skrip, env, strategi test, format progres |

Prioritas bila dua dokumen bertentangan: `00` > `02` > `03` > `04-database` > `06` > `05-api` > `07/08/09` > `10`.

## Aturan kerja (mutlak)

1. **Jangan mengubah keputusan terkunci** (K-xx, R-xx). Jika spesifikasi kontradiktif atau mustahil:
   pilih tafsiran yang paling aman bagi data & akses, catat di `docs/progress.md` → `## Pertanyaan untuk operator`, lanjutkan.
2. **Struktur folder & batas LOC adalah syarat selesai**, bukan kosmetik. `pnpm check:repo` wajib lulus di setiap milestone.
3. **Jangan pernah melaporkan sesuatu berhasil tanpa melihatnya berhasil.** Jumlah test, hasil, durasi = kutipan output asli.
4. Di akhir **setiap giliran**, tampilkan: milestone aktif, kriteria yang sudah/belum, dan ekor output asli dari
   perintah verifikasi yang dijalankan di giliran itu (penilai `/goal` hanya melihat transkrip).
5. Setiap perubahan datang bersama test yang mengunci invariannya. Jangan mematikan, melewati, atau melemahkan
   test/lint/aturan untuk membuat sesuatu lulus. Perbaiki **akar masalah**.
6. Tidak ada `TODO`, stub, atau data palsu di kode yang dinyatakan selesai. Yang belum dikerjakan ditulis sebagai
   "TIDAK dikerjakan" di progres.
7. **Commit lokal di akhir setiap milestone** (`feat(mN): ...`), setelah verifikasi milestone lulus. **Jangan push.**
8. Tidak ada rahasia di commit (`.env`, kunci, password). Password dev hanya di `.env.example`/dokumen seed.
9. Hanya sentuh database `evehydrofarm` dan `evehydrofarm_test` (plus cluster cadangan `db:cluster`). Jangan
   mengubah konfigurasi service Postgres operator. Jangan memasang software sistem global selain dependency proyek
   (pnpm, `flutter pub`) dan browser Playwright (`pnpm exec playwright install chromium`).
10. Bahasa: TypeScript untuk semua kode non-mobile, Dart untuk mobile. Tidak ada bahasa lain di repo.
11. Jika satu milestone terblokir hal di luar kendali (mis. jaringan), catat buktinya, kerjakan milestone lain yang
    tidak bergantung padanya, lalu kembali.

## Prasyarat

- `.env` diisi operator dari `.env.example` (`10-kualitas-pengujian.md` §2). Jika `DATABASE_ADMIN_URL` kosong atau
  gagal konek, pakai mode cadangan `pnpm db:cluster` (§3 dokumen yang sama) dan catat di progres.
- Tooling terpasang: Node 22.22, pnpm 10.13, PostgreSQL 18, Flutter 3.41.4 / Dart 3.11.1, Android SDK, Java 17, Chrome.
- Internet saat install pertama (npm, pub, Gradle, Playwright chromium, unduhan SQLite oleh paket `sqlite3`).

## Milestone

Setiap milestone selesai = semua kriteria tercentang + semua perintah verifikasinya lulus + progres ditulis + commit.

### M0 — Fondasi monorepo
- [ ] Pohon root persis `02-struktur-folder.md` §1; `pnpm-workspace.yaml`, preset `@eve/tsconfig`, `@eve/eslint-config`, Prettier, `.editorconfig`, `.gitignore`, `.gitattributes` (`* text=auto eol=lf`), `.env.example` lengkap; versi terpin `01-arsitektur.md`.
- [ ] `tools/repo-check` lengkap (LOC, nama terlarang, maks 12 file/folder, root, impor lintas app, `.skip/.only`) + test tiap aturan.
- [ ] Semua skrip root `10-kualitas-pengujian.md` §1 ada; yang targetnya belum dibangun gagal dengan pesan jelas "belum diimplementasi (Mx)" sampai milestone pemiliknya.
- [ ] `README.md` singkat + `docs/progress.md` dibuat.
- Verifikasi: `pnpm install`, `pnpm format:check`, `pnpm check:repo`, `pnpm lint`, `pnpm typecheck`, `pnpm --filter @eve/repo-check test`.

### M1 — Database (`packages/db`)
- [ ] `db:setup`, `db:cluster`, `db:migrate` (checksum), `db:codegen`, `db:seed [--demo]`, `db:reset`.
- [ ] Migrasi `0001..0017` = DDL `04-database/01..16` apa adanya; seed sesuai `17-seed.md`.
- [ ] Test DB: migrasi dari nol, checksum berubah → gagal, semua invarian tiap dokumen `04-database`, **semua test akses `03-peran-akses.md` §6 sebagai `eve_api`**, aturan R-01..R-14 yang ditegakkan DB.
- Verifikasi: `pnpm db:setup`, `pnpm db:reset`, `pnpm db:codegen` lalu `git diff --exit-code packages/db/src/generated`, `pnpm --filter @eve/db test`.

### M2 — Kontrak (`packages/contracts`)
- [ ] Skema Zod untuk setiap request/response `05-api/*` dan setiap tipe mutasi `06-sinkronisasi.md` §4.3; enum = `CHECK` DB.
- Verifikasi: `pnpm --filter @eve/contracts test`, `pnpm typecheck`.

### M3 — App Pusat inti
- [ ] Plugin (`database`, `authenticate`, `request-scope`, `error-handler`, `openapi`, `rate-limit`, `cors`), env, `iam/*`, `core/*`, `agro/catalog`, `inventory/products`, `sales/skus`, `sales/price-lists`, `sales/customers`, `system/health`, JWKS.
- [ ] Test per endpoint (sukses, 400, 401, 403, 404 scope lain) + test token (rotasi, reuse → cabut keluarga, `SCOPE_CHANGED`).
- Verifikasi: `pnpm --filter @eve/api test`, `pnpm openapi:check`.

### M4 — App Pusat operasi, stok, penjualan, bahan & biaya, laporan
- [ ] `agro/*`, `inventory/*` (termasuk bahan), `sales/sales`, `sales/receipts`, `sales/sale-voids`, `sales/orders`, `costing/*`, `reports/*`, `files/attachments`, `site/*`, `audit/audit-logs`.
- [ ] Aturan R-01..R-14 dibuktikan test (termasuk alokasi biaya R-08 & harga rata-rata R-09 dengan angka contoh); CSV laporan; cakupan ≥ 70% `src/modules/**`.
- Verifikasi: `pnpm --filter @eve/api test -- --coverage`, `pnpm openapi:check`.

### M5 — Sinkronisasi (App Pusat)
- [ ] `sync/devices`, `sync/pull` (algoritma `06` §3.2 persis), `sync/push` (registry **semua** tipe mutasi §4.3, idempoten).
- [ ] Semua test wajib `06-sinkronisasi.md` §9, termasuk celah urutan commit dengan dua koneksi nyata.
- Verifikasi: `pnpm --filter @eve/api test`.

### M6 — Website (`apps/web`)
- [ ] Semua halaman `07-website/*` (publik, admin, supervisor, seller, nota cetak, HPP & laba), BFF cookie `httpOnly`, gating peran (worker ditolak), format Rupiah/berat/satuan/tanggal zona farm.
- [ ] Semua alur `07-website/05-alur-e2e.md` lulus di Playwright terhadap `api:test-server`.
- Verifikasi: `pnpm --filter @eve/web build`, `pnpm e2e`.

### M7 — Mobile (`apps/mobile`)
- [ ] Semua layar per peran `08-mobile/*`, DB lokal drift, outbox, sync engine `06`, Pusat Sinkron, penomoran offline, nota (PNG/PDF/share, ESC/POS 58 mm Bluetooth).
- [ ] "Test wajib" `08-mobile/05-pengujian.md` + integrasi nyata ke App Pusat (`mobile:it`).
- Verifikasi: `pnpm mobile:analyze`, `pnpm mobile:test`, `pnpm mobile:it`, `pnpm mobile:build`.

### M8 — Monitoring (`apps/monitoring`)
- [ ] Ingest `X-Device-Key`, ambang, alert, UI, auth via JWKS App Pusat, simulator sensor `09-monitoring/*`.
- [ ] Test Vitest + "Alur e2e" `09-monitoring/03-simulator-pengujian.md`.
- Verifikasi: `pnpm --filter @eve/monitoring test`, `pnpm --filter @eve/monitoring build`, `pnpm e2e`.

### M9 — Penutup
- [ ] `pnpm verify` lulus dalam satu run; ekor output tiap langkah dikutip di progres.
- [ ] `README.md` final: setup, `.env`, menjalankan 4 aplikasi + simulator, akun demo, uji printer manual.
- [ ] `docs/progress.md`: semua M0–M9 `SELESAI`, daftar "TIDAK dikerjakan" hanya berisi hal di luar cakupan `00` §Di luar cakupan.
- [ ] `git status` bersih; satu commit per milestone.

## Definition of Done (global)

Semua benar **pada saat yang sama**, dibuktikan output asli di `docs/progress.md` dan di transkrip:
1. `pnpm verify` exit 0 (format, repo-check, lint, typecheck, semua test, OpenAPI, e2e, mobile analyze/test/it/build).
2. `pnpm db:reset` dari nol lulus (migrasi + seed demo).
3. `pnpm check:repo` 0 pelanggaran: struktur folder persis `02`, tidak ada file > batas LOC.
4. Tidak ada `TODO`/`FIXME`/`test.skip`/`it.only` di kode yang di-commit.
5. Milestone M0–M9 `SELESAI`; setiap milestone punya commit lokal; tidak ada push.
