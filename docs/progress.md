# Progres Eve Hydrofarm

Format dan aturan penulisan: `docs/spec/10-kualitas-pengujian.md` §6. Angka hanya dari output perintah nyata.

## Pertanyaan untuk operator

Tidak ada yang terbuka. Keputusan risiko yang muncul dari review DB sudah dicatat sebagai R-12..R-14
di `docs/spec/00-keputusan-asumsi.md` (operator boleh mengubahnya sebelum `/goal`).

## Kerangka (skeleton) — 2026-09-24 — SELESAI

Dikerjakan (mencakup kriteria M0 kecuali yang disebut di bawah):
- Root monorepo persis `02-struktur-folder.md` §1: `package.json` (semua skrip `10-kualitas` §1),
  `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.editorconfig`, `.gitignore`, `.gitattributes` (LF), Prettier, `.env.example`, `README.md`.
- `packages/tsconfig` (preset `node.json`, `next.json`; ESM, `strict`, `noUncheckedIndexedAccess`, impor `.ts`),
  `packages/eslint-config` (preset `node`, `next`; `no-explicit-any`, `no-console`, larangan impor DB untuk Website).
- `tools/repo-check` **lengkap**: pohon root & tingkat atas, nama terlarang, maks 12 file/folder, LOC 200/300/400,
  `.md` di `src/`/`lib/`, README ≤ 80 baris, impor lintas app, impor DB dari Website, penanda kerja tertunda,
  test `.only/.skip/.skipIf/.todo` dan `skip:` Dart. 56 test.
- `packages/contracts`: primitif (id, rupiah, gram, paginasi, amplop error + kode error `05-api` §3) + kontrak health.
- `packages/db`: `createDb` (Kysely + pg) dan perencana migrasi (urut versi, checksum LF/CRLF, tolak edit/hilang/nomor mundur).
- `apps/api`: Fastify 5 + Zod 4, `GET /health`, 404 beramplop error + `x-request-id`, env tervalidasi Zod.
  Diuji juga lewat HTTP nyata (server jalan, `curl /health` → 200, rute tak dikenal → 404 JSON).
- `apps/web`, `apps/monitoring`: Next.js 16 + Tailwind 4, halaman sementara yang menyatakan dirinya kerangka.
- `apps/mobile`: `flutter create` (android, ios), paket terpin persis `01-arsitektur.md`, `lib/app` (router, tema,
  env `API_BASE_URL`), layar `/masuk` sementara, minSdk 24 (tertinggi yang diminta plugin), label "Eve Hydrofarm".
- Spesifikasi: `04-database/` dipecah ke subfolder `fondasi/ domain/ platform/ keamanan/` karena `repo-check`
  menemukan folder itu melewati batas 12 file (§8.2); `00-konvensi.md` §8 memuat tata letak final.

TIDAK dikerjakan / sisa (sengaja, milik milestone lain):
- Skrip `db:*` (M1), `api:keys`, `api:test-server`, `openapi:check` (M3), `e2e` (M6/M8), `mobile:it` (M7) gagal
  dengan pesan "belum diimplementasi (Mx)". Karena itu `pnpm verify` **belum** bisa lulus — langkah `openapi:check` gagal.
- Belum ada migrasi SQL, plugin database/auth/RLS, halaman fitur, layar fitur mobile, atau monitoring.
- `/health` melaporkan `checks.database = not-configured` sampai plugin database ada (M3).
- Build pertama APK mencetak stack trace Kotlin "different roots" (pub cache di C:, proyek di D:); build tetap sukses
  dan build berikutnya bersih. Tidak diubah (`kotlin.incremental=false` = keputusan operator bila log mengganggu).

Verifikasi (output asli, dijalankan berurutan dari keadaan akhir):

```text
$ pnpm format:check
All matched files use Prettier code style!
Formatted 10 files (0 changed) in 0.02 seconds.
[exit 0]
$ pnpm check:repo
repo-check: 180 file diperiksa, 0 pelanggaran.
[exit 0]
$ pnpm lint
apps/api lint: Done
[exit 0]
$ pnpm typecheck
apps/api typecheck: Done
[exit 0]
$ pnpm test
tools/repo-check test:       Tests  56 passed (56)
packages/contracts test:       Tests  6 passed (6)
packages/db test:       Tests  7 passed (7)
apps/api test:       Tests  5 passed (5)
[exit 0]
$ pnpm --filter @eve/web build
○  (Static)  prerendered as static content
[exit 0]
$ pnpm --filter @eve/monitoring build
○  (Static)  prerendered as static content
[exit 0]
$ pnpm mobile:analyze
No issues found! (ran in 12.1s)
[exit 0]
$ pnpm mobile:test
00:00 +9: All tests passed!
[exit 0]
$ pnpm mobile:build
√ Built build\app\outputs\flutter-apk\app-debug.apk
[exit 0]
```

Commit: lihat `git log` — `feat(skeleton): ...`.
