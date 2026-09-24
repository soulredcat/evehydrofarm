# 04.00 — Konvensi Database (PostgreSQL 18)

Berlaku untuk semua file `04-database/*.md` dan semua migrasi `packages/db/migrations/*.sql`.
DDL di dokumen ini adalah **sumber kebenaran**; migrasi menyalinnya apa adanya (dipecah per file ≤ 400 baris).

## 1. Schema

| Schema | Isi | Pemilik tulis |
|---|---|---|
| `meta` | fungsi trigger generik, `meta.schema_migration` | migrasi |
| `iam` | user, assignment, refresh token, perangkat, fungsi konteks RLS | App Pusat |
| `core` | farm, greenhouse, reservoir (tandon), blok, meja | App Pusat |
| `agro` | komoditas, varietas, tahap tumbuh, target nutrisi, siklus tanam, kegiatan, cek air, tugas, masalah, panen | App Pusat |
| `inventory` | produk, lot, pergerakan stok, penyesuaian, selisih | App Pusat |
| `sales` | pelanggan, daftar harga, penjualan, item, pembayaran, void | App Pusat |
| `files` | metadata lampiran foto | App Pusat |
| `site` | pesan kontak website | App Pusat |
| `sync` | change log, mutasi yang sudah diproses | App Pusat (via trigger) |
| `audit` | log audit | trigger |
| `monitoring` | perangkat sensor, sensor, pembacaan, ambang, alert | Monitoring |

## 2. Penamaan & tipe

- Tabel **tunggal** `snake_case`: `core.grow_table`, `sales.sale_item`. (`table` adalah kata kunci → meja = `grow_table`.)
- PK: `id uuid PRIMARY KEY DEFAULT uuidv7()` (fungsi bawaan PG18). Entitas yang dibuat offline menerima `id` dari klien.
  Pengecualian: `sync.change_log.seq bigserial`, `audit.audit_log.id bigserial`, `monitoring.reading` (PK komposit).
- FK: `<entitas>_id`, selalu diberi index. `ON DELETE RESTRICT` (default); tidak ada `CASCADE` pada data bisnis.
- Enum = `text` + `CHECK (col IN (...))` (bukan tipe `ENUM` Postgres, agar mudah dikembangkan). Nilai `UPPER_SNAKE`.
- Kode singkat (farm, greenhouse, blok, meja): `text` dengan `CHECK (code ~ '^[A-Z0-9]{1,6}$')`.
- Berat: `weight_g integer CHECK (weight_g > 0)`; pergerakan stok `quantity_g integer` (bertanda).
- Uang: `bigint` rupiah utuh, `CHECK (>= 0)` kecuali disebut lain. Harga per kg: `price_per_kg bigint`.
- Nilai ukur (pH, EC, suhu): `numeric(p,s)` — tidak ada `real`/`double precision`.
- Waktu kejadian lapangan: `occurred_at`/`harvested_at`/`sold_at` (`timestamptz`, waktu perangkat).
  Waktu server: `created_at timestamptz NOT NULL DEFAULT now()`.
- Tanggal kalender (jatuh tempo, tanggal semai): `date`.

## 3. Kelompok tabel & kolom wajib

| Kelompok | Contoh | Kolom wajib tambahan | Perilaku |
|---|---|---|---|
| **Master** | farm, greenhouse, block, grow_table, reservoir, commodity, variety, product, customer | `updated_at`, `version integer NOT NULL DEFAULT 1`, `archived_at timestamptz` | UPDATE boleh; DELETE dilarang (arsip saja) |
| **Berstatus** | planting_cycle, task, issue, lot, stock_adjustment, stock_discrepancy, sale_void, alert | `updated_at`, `version` | UPDATE hanya kolom status/keputusan; DELETE dilarang |
| **Fakta (append-only)** | activity, activity_input, water_check, harvest, stock_movement, price_list, sale, sale_item, payment, cycle_stage_event | `created_by`, `device_id` (nullable) | UPDATE & DELETE **dilarang oleh trigger** |

Semua tabel bisnis: `created_at`, `created_by uuid REFERENCES iam.user_account(id)` (nullable hanya untuk seed/publik).

## 4. Fungsi & trigger generik (schema `meta`)

| Fungsi | Dipasang | Efek |
|---|---|---|
| `meta.touch_row()` | BEFORE UPDATE master & berstatus | `updated_at = now()`, `version = OLD.version + 1` |
| `meta.forbid_update_delete()` | BEFORE UPDATE OR DELETE fakta | `RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'APPEND_ONLY'` |
| `meta.forbid_delete()` | BEFORE DELETE master & berstatus | `RAISE EXCEPTION ... 'NO_DELETE'` |
| `meta.check_version()` | BEFORE UPDATE berstatus | tolak bila `NEW.version` dikirim ≠ `OLD.version` (optimistic lock; kode `VERSION_CONFLICT`) |
| `sync.capture_change()` | AFTER INSERT OR UPDATE semua tabel yang disinkron | tulis `sync.change_log` (lihat `09-sync.md`) |
| `audit.capture()` | AFTER INSERT OR UPDATE master, berstatus, `iam.*` | tulis `audit.audit_log` dengan `before/after jsonb` |

Kode error kustom memakai `ERRCODE` kelas `P0001` + `MESSAGE` = kode stabil (`APPEND_ONLY`, `NO_DELETE`,
`VERSION_CONFLICT`, `SCOPE_MISMATCH`, `PHI_ACTIVE`, ...). App Pusat memetakan `MESSAGE` ke respons HTTP.

## 5. Denormalisasi scope (wajib untuk RLS)

Setiap tabel yang berada di bawah farm/greenhouse punya kolom `farm_id uuid NOT NULL` dan
(bila relevan) `greenhouse_id uuid NOT NULL`. Kolom ini **diisi trigger BEFORE INSERT dari induk**
(`meta.fill_scope_from_<induk>()` per kasus). Jika klien mengirim nilai yang tidak cocok dengan induk →
`SCOPE_MISMATCH`. Kolom lokasi turunan lain (mis. `sale_item.block_id`, `sale_item.grow_table_id` dari lot)
diisi dengan cara yang sama — sehingga "meja mana, blok mana" tersedia langsung di setiap baris.

## 6. Konteks RLS (schema `iam`)

App Pusat & Monitoring menjalankan `set_config('app.<kunci>', nilai, true)` di awal setiap transaksi.

| Fungsi (`STABLE`) | Nilai |
|---|---|
| `iam.ctx_user_id() → uuid` | `nullif(current_setting('app.user_id', true), '')::uuid` |
| `iam.ctx_role() → text` | `ADMIN`/`SUPERVISOR`/`SELLER`/`WORKER`/`ANON`/`DEVICE`, atau `NULL` |
| `iam.ctx_farm_id() → uuid` | farm scope |
| `iam.ctx_greenhouse_id() → uuid` | greenhouse scope (WORKER, DEVICE) |
| `iam.can_see_farm_row(farm_id uuid) → boolean` | ADMIN; atau `farm_id = ctx_farm_id()` untuk SUPERVISOR/SELLER/WORKER |
| `iam.can_see_gh_row(farm_id uuid, greenhouse_id uuid) → boolean` | ADMIN; SUPERVISOR/SELLER bila farm cocok; WORKER bila greenhouse cocok |

Konteks kosong (`ctx_role() IS NULL`) → semua policy bernilai false (test wajib §6 no.7 di `03-peran-akses.md`).
Semua tabel bisnis: `ENABLE` **dan** `FORCE ROW LEVEL SECURITY`. Policy per tabel ada di `12-rls.md`, grant di `13-grants.md`.

## 7. Aturan migrasi

- File: `packages/db/migrations/NNNN_<nama>.sql`, dijalankan urut dalam transaksi masing-masing oleh
  `packages/db/src/migrate/run-migrations.ts` sebagai `eve_owner`; dicatat di `meta.schema_migration(version, name, checksum, applied_at)`.
- Checksum file yang sudah diterapkan berubah → runner **gagal** (migrasi tidak pernah diedit; buat file baru).
- Role cluster (`eve_owner`, `eve_api`, `eve_monitoring`, `eve_readonly`) dan database dibuat oleh
  `pnpm db:setup` (butuh `DATABASE_ADMIN_URL`), **bukan** oleh migrasi.
- Setelah migrasi: `pnpm db:codegen` (kysely-codegen, `--include-pattern` semua schema di §1) →
  `packages/db/src/generated/database.ts`. Tabel dirujuk di Kysely sebagai `'core.farm'`, dst.

## 8. Urutan file migrasi

Urutan dokumen `04-database/NN-*.md` = urutan migrasi. Blok ```` ```sql ```` di dokumen, dibaca urut
dari `01` sampai `13`, harus bisa dijalankan apa adanya pada database kosong.

| Dokumen | File migrasi | Isi |
|---|---|---|
| `01-schemas-meta.md` | `0001_schemas.sql`, `0002_meta_functions.sql` | `CREATE SCHEMA` §1, `REVOKE ALL ON SCHEMA public FROM PUBLIC`; fungsi generik §4 |
| `02-iam.md` | `0003_iam.sql` | tabel iam + fungsi konteks §6 |
| `03-core.md` | `0004_core.sql` | farm, greenhouse, reservoir, blok, meja |
| `04-agro-katalog.md` | `0005_agro_catalog.sql` | komoditas, varietas, tahap, target nutrisi |
| `05-agro-operasi.md` | `0006_agro_operations.sql` | siklus, kegiatan, cek air, tugas, masalah, panen |
| `06-inventory.md` | `0007_inventory.sql` | produk, lot, pergerakan, penyesuaian, selisih, view saldo |
| `07-sales.md` | `0008_sales.sql` | pelanggan, harga, penjualan, item, pembayaran, void, view ringkasan |
| `08-files-site.md` | `0009_files_site.sql` | lampiran, pesan kontak |
| `09-sync.md` | `0010_sync.sql` | change log, processed mutation, `sync.capture_change()` + pemasangan trigger |
| `10-audit.md` | `0011_audit.sql` | audit log, `audit.capture()` + pemasangan trigger |
| `11-monitoring.md` | `0012_monitoring.sql` | tabel monitoring |
| `12-rls.md` | `0013_rls_policies.sql` | `ENABLE/FORCE RLS` + semua policy |
| `13-grants.md` | `0014_grants.sql` | `GRANT` per role |
| `14-seed.md` | — (script TS `packages/db/src/seed/`) | data awal & data demo |

Urutan logis tabel ini tetap. Jika satu isi melebihi 400 baris, pecah menjadi beberapa file bernomor
berurutan (nomor boleh bergeser saat implementasi pertama; setelah commit nomor tidak pernah diubah).
