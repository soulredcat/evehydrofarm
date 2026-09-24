# 02 — Struktur Folder & Batas Ukuran File (MUTLAK)

> Aturan operator: **folder super rapi, penempatan jelas, mutlak dan wajib.**
> Pelanggaran aturan di dokumen ini = pekerjaan **belum selesai**, meskipun fitur berjalan.
> `pnpm check:repo` (lihat `tools/repo-check`) menegakkan aturan ini dan wajib lulus.

## 1. Pohon tingkat atas (tidak boleh ditambah)

```text
evehydrofarm/
├── GOAL.md                 # titik masuk /goal
├── README.md               # cara setup & menjalankan (singkat)
├── package.json            # script root saja (dev tooling), tanpa dependency runtime
├── pnpm-workspace.yaml     # apps/*, packages/*, tools/*
├── .editorconfig  .gitignore  .gitattributes  .prettierrc.json  .prettierignore  .env.example
├── apps/
│   ├── api/                # APP PUSAT (backend TS)
│   ├── web/                # WEBSITE (Next.js)
│   ├── mobile/             # MOBILE (Flutter)
│   └── monitoring/         # MONITORING (Next.js, app terpisah)
├── packages/
│   ├── contracts/          # skema Zod lintas aplikasi TS
│   ├── db/                 # migrasi SQL, setup, seed, tipe Kysely
│   ├── eslint-config/      # preset ESLint
│   └── tsconfig/           # preset tsconfig
├── tools/
│   └── repo-check/         # penegak aturan LOC + struktur
└── docs/
    ├── spec/               # spesifikasi (dokumen ini)
    └── progress.md         # log progres milestone /goal
```

Tidak ada file/folder lain di root. Tidak ada `scripts/`, `src/`, `lib/`, `config/` di root.

## 2. `apps/api` — App Pusat

```text
apps/api/
├── package.json  tsconfig.json  eslint.config.js  vitest.config.ts
├── openapi.json                    # hasil generate, di-commit
├── src/
│   ├── main.ts                     # start server saja
│   ├── app.ts                      # buildApp(): daftar plugin + modul
│   ├── config/env.ts               # env tervalidasi Zod
│   ├── plugins/                    # 1 plugin Fastify per file
│   │   ├── database.ts  authenticate.ts  request-scope.ts  error-handler.ts
│   │   └── openapi.ts  rate-limit.ts  cors.ts
│   └── modules/<domain>/<modul>/   # domain = nama schema DB (iam, core, agro, ...); 1 modul = 1 kapabilitas
│       ├── index.ts                # registrasi plugin modul
│       ├── <modul>.routes.ts       # definisi route HTTP saja
│       ├── <modul>.service.ts      # logika bisnis + transaksi
│       ├── <modul>.repo.ts         # query Kysely saja
│       ├── <modul>.policy.ts       # siapa boleh apa
│       └── <modul>.mapper.ts       # baris DB ↔ DTO kontrak (opsional)
└── test/
    ├── support/                    # build app, reset DB, factory data
    └── <domain>/<modul>/<kasus>.test.ts   # mencerminkan src/modules
```

Aturan modul:
- Nama file peran **tetap** (`routes/service/repo/policy/mapper/index`). Tidak ada nama lain di akar modul.
- Jika satu file peran melewati batas, pecah menjadi **sub-modul** dengan pola yang sama:
  `modules/sales/sales/payments/payments.routes.ts`, `payments.service.ts`, ...
- Daftar domain & modul yang sah ada di `05-api/00-konvensi.md` §8. Folder domain hanya berisi folder modul.
- `routes` tidak boleh menyentuh DB; `repo` tidak boleh berisi aturan bisnis; `service` tidak boleh tahu HTTP.
- Handler mutasi sync hidup di modul pemilik entitas (mis. `harvests.service.ts`), bukan di `modules/sync`.

## 3. `apps/web` — Website

```text
apps/web/
├── package.json  next.config.ts  tsconfig.json  eslint.config.js  postcss.config.mjs  playwright.config.ts
├── public/                         # gambar statis, favicon
├── e2e/<alur>.spec.ts              # Playwright, 1 file per alur
└── src/
    ├── middleware.ts               # redirect auth saja
    ├── app/                        # ROUTING SAJA — file tipis, isi diambil dari features/
    │   ├── (publik)/page.tsx  produk/  tentang/  kontak/
    │   ├── (auth)/masuk/
    │   ├── (dashboard)/dashboard/<halaman>/
    │   └── api/auth/<login|logout|refresh>/route.ts   # BFF token → cookie
    ├── features/<fitur>/
    │   ├── components/<nama>.tsx   # 1 komponen diekspor per file
    │   └── server/
    │       ├── queries.ts          # GET ke App Pusat (server-only)
    │       └── actions.ts          # server action mutasi (server-only)
    ├── ui/<komponen>.tsx           # design system: button, input, dialog, data-table, ...
    ├── layout/<bagian>.tsx         # shell: sidebar, topbar, public-header, public-footer
    └── server/                     # infrastruktur server-only
        ├── api-client.ts  session.ts  env.ts
```

- Segmen URL (nama folder di `app/`) = **Bahasa Indonesia** (`/dashboard/penjualan`). Nama folder `features/` = Inggris.
- `page.tsx` hanya merakit komponen dari `features/` dan memanggil `server/queries.ts`. Tanpa logika.

## 4. `apps/monitoring` — Monitoring (terpisah)

Sama persis dengan `apps/web`, ditambah:

```text
apps/monitoring/
├── simulator/                      # simulator sensor ESP32 (TS, dijalankan dengan tsx)
│   ├── main.ts  profiles.ts  send-batch.ts
├── test/<fitur>/<kasus>.test.ts    # Vitest untuk logika server
└── src/
    ├── app/api/ingest/route.ts     # endpoint ingest sensor (tipis)
    └── features/<fitur>/server/
        ├── <fitur>.service.ts  <fitur>.repo.ts   # monitoring boleh akses DB langsung (schema monitoring)
```

## 5. `apps/mobile` — Flutter

```text
apps/mobile/
├── pubspec.yaml  analysis_options.yaml  build.yaml
├── android/  ios/                  # hasil `flutter create`, jangan tambah platform lain
├── assets/images/
├── lib/
│   ├── main.dart
│   ├── app/                        # app.dart, router.dart, theme.dart, env.dart
│   ├── data/
│   │   ├── local/                  # drift
│   │   │   ├── app_database.dart
│   │   │   ├── tables/<entitas>_table.dart
│   │   │   └── daos/<entitas>_dao.dart
│   │   ├── remote/                 # api_client.dart, auth_interceptor.dart, dto/<entitas>_dto.dart
│   │   └── sync/                   # sync_engine.dart, outbox_writer.dart, push_runner.dart,
│   │                               # pull_runner.dart, row_applier.dart, sync_state.dart
│   ├── features/<fitur>/
│   │   ├── <fitur>_repository.dart # baca DB lokal, tulis lewat outbox
│   │   ├── <fitur>_providers.dart  # Riverpod
│   │   ├── screens/<nama>_screen.dart
│   │   └── widgets/<nama>.dart
│   └── ui_kit/<widget>.dart        # widget bersama: tombol, kartu, teks rupiah/berat, empty state
└── test/                           # mencerminkan lib/ (test/data/..., test/features/...)
```

- Layar tidak memanggil `dio` atau DAO langsung — hanya lewat `<fitur>_providers.dart` → `<fitur>_repository.dart`.
- Semua tulis dari layar → repository → `outbox_writer.dart` (satu transaksi drift: baris lokal + entri outbox).

## 6. `packages/*` dan `tools/*`

```text
packages/db/
├── migrations/NNNN_<nama>.sql      # SQL tulisan tangan, urut, tidak pernah diedit setelah commit
└── src/
    ├── index.ts                    # ekspor createDb + tipe
    ├── client/create-db.ts
    ├── migrate/run-migrations.ts  migrate/cli.ts
    ├── setup/setup-roles.ts  setup/cli.ts
    ├── seed/<area>.seed.ts  seed/cli.ts
    └── generated/database.ts       # output kysely-codegen (jangan diedit tangan)

packages/contracts/src/
├── index.ts
├── primitives/                     # id, uang, berat, tanggal, paginasi, error
├── enums/<domain>.ts
└── <domain>/<entitas>.ts           # iam/, core/, agro/, inventory/, sales/, files/, site/, sync/, reports/, monitoring/

tools/repo-check/
├── src/main.ts  rules.ts  walk-files.ts  check-loc.ts  check-structure.ts  check-imports.ts
└── test/<aturan>.test.ts           # fixture pelanggaran dibuat di folder temp saat test
```

Setiap app/package TS punya `package.json`, `tsconfig.json` (extends `@eve/tsconfig`),
`eslint.config.js` (extends `@eve/eslint-config`), dan `test/` sendiri. Nama paket: `@eve/<nama>`.

## 7. Penamaan

| Hal | Aturan | Contoh |
|---|---|---|
| File TS/TSX | `kebab-case` | `sale-form.tsx`, `harvests.service.ts` |
| File Dart | `snake_case` | `harvest_form_screen.dart` |
| Folder TS | `kebab-case` | `planting-cycles/` |
| Folder Dart | `snake_case` | `water_checks/` |
| Migrasi | `NNNN_snake_case.sql` | `0007_sales.sql` |
| Komponen React / kelas Dart | `PascalCase`, sama dengan nama file | `SaleForm` di `sale-form.tsx` |
| Test TS / Dart | `<kasus>.test.ts` / `<kasus>_test.dart` | `worker-scope.test.ts` |

## 8. Larangan

1. **Nama folder/file terlarang** (tidak peka huruf besar/kecil) di mana pun:
   `utils`, `util`, `helpers`, `helper`, `misc`, `common`, `shared`, `stuff`, `temp`, `tmp`,
   `old`, `new`, `backup`, `copy`, `lib` — **kecuali** `apps/mobile/lib` (wajib oleh Flutter).
2. Maks **12 file** per folder (tidak termasuk hasil generate). Lebih dari itu → pecah jadi subfolder bermakna.
3. Tidak ada file kode di luar pohon di atas. Tidak ada file `.md` di dalam `src/`/`lib/`
   (kecuali `README.md` di akar tiap app/package, ≤ 80 baris).
4. Tidak ada kode mati, file berkomentar-seluruhnya, atau file "sementara".
5. Tidak ada `index.ts` barrel di folder dalam, kecuali `index.ts` modul API dan entry paket.
6. Tidak ada impor lintas app (`apps/web` tidak boleh impor dari `apps/api`, dst.). Berbagi hanya lewat `packages/*`.

## 9. Batas baris per file (LOC) — 200 / 300 / 400

Dihitung **semua baris fisik** (termasuk kosong & komentar). Angka = batas atas.

| Batas | Berlaku untuk |
|---|---|
| **200** | Semua `.tsx`; `*.routes.ts`, `*.policy.ts`, `*.mapper.ts`, `index.ts`, `middleware.ts`; semua file di `src/app/**` (Next.js); Dart di `screens/`, `widgets/`, `ui_kit/`, `app/`; `main.ts`, `main.dart`; file config (`*.config.ts`, `next.config.ts`). |
| **300** | `*.service.ts`, `*.repo.ts`, file di `server/`, `plugins/`, `packages/contracts/**`, `packages/db/src/**` (non-generated), `tools/**`, `simulator/**`; Dart di `data/**`, `*_repository.dart`, `*_providers.dart`. |
| **400** | **Batas mutlak semua file lain**: migrasi `.sql`, test (`*.test.ts`, `*.spec.ts`, `*_test.dart`), `.css`, dokumen `.md`. Tidak ada file yang boleh > 400. |

Dikecualikan dari hitungan: `packages/db/src/generated/**`, `**/*.g.dart`, `apps/api/openapi.json`,
lockfile, `apps/mobile/android/**`, `apps/mobile/ios/**`, `node_modules`, `.next`, `dist`, `build`, `.dart_tool`,
file biner/gambar. Ekstensi yang dihitung: `.ts .tsx .js .mjs .cjs .dart .sql .md .css`.

Cara memenuhi batas = **memecah berdasarkan tanggung jawab**, bukan memadatkan kode
(dilarang: menggabung baris, menghapus format Prettier/`dart format`, mematikan aturan lint).

## 10. `tools/repo-check`

`pnpm check:repo` menjalankan `tools/repo-check` dan **gagal (exit 1)** bila:
- ada file melebihi batas LOC tabel §9 (cetak path, jumlah baris, batas);
- ada nama terlarang §8.1, folder > 12 file §8.2, atau `.md` di dalam `src/`/`lib/`;
- ada file/folder root di luar §1;
- ada impor lintas app (`from '../../api'`, `@eve/api` di web, dsb.).

Aturan batas & pengecualian didefinisikan sekali di `tools/repo-check/src/rules.ts`, sama dengan dokumen ini.
Test `tools/repo-check/test/` membuktikan setiap aturan menolak contoh pelanggaran.
