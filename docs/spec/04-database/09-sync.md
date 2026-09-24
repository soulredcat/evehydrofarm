# 04.09 — Schema `sync` (change log & idempotensi mutasi)

Migrasi: `0010_sync.sql`. Setiap INSERT/UPDATE pada tabel yang disinkron ke mobile menulis satu baris
`sync.change_log` lewat trigger `sync.capture_change()`. Pull membaca log ini (difilter RLS sesuai
visibilitas), lalu mengambil baris terbaru dari tabel sumbernya. `sync.processed_mutation` membuat push
idempoten. Protokol lengkap (format push/pull, reset scope): `06-sinkronisasi.md`.

## 1. Tabel

`sync.change_log` — tulis hanya lewat trigger (`SECURITY DEFINER`); aplikasi hanya `SELECT`.

| Kolom | Tipe | Aturan |
|---|---|---|
| `seq` | `bigserial` PK | urutan penulisan (bukan urutan commit) |
| `tx_id` | `xid8` | default `pg_current_xact_id()` — transaksi penulis |
| `table_name` | `text` | `schema.table` |
| `row_id` | `uuid` | `id` baris sumber |
| `farm_id`, `greenhouse_id` | `uuid` NULL | scope baris saat ditulis |
| `visibility` | `text` | `GLOBAL`/`FARM`/`FARM_STAFF`/`GREENHOUSE` |
| `op` | `char(1)` | `I`/`U` (DELETE tidak ada di sistem) |
| `changed_at` | `timestamptz` | default `now()` |

`sync.processed_mutation` — FACT (append-only), satu baris per mutasi outbox yang sudah diproses.

| Kolom | Tipe | Aturan |
|---|---|---|
| `mutation_id` | `uuid` PK | id mutasi dari outbox klien (UUIDv7) |
| `user_id` | `uuid` → user_account | pengirim; RLS: hanya baris milik sendiri |
| `device_id` | `uuid` NULL → device | |
| `type` | `text` | nama mutasi, `^[A-Za-z0-9_.:-]{1,64}$` |
| `status` | `text` | `APPLIED`/`REJECTED`; `REJECTED` ⇔ `error_code` terisi |
| `error_code`, `result` | `text`, `jsonb` NULL | dikembalikan apa adanya bila mutasi dikirim ulang |
| `processed_at` | `timestamptz` | default `now()` |

## 2. Visibilitas (dipakai policy `change_log_select` di `12-rls.md`)

| Nilai | Siapa melihat | Dipakai untuk |
|---|---|---|
| `GLOBAL` | semua peran login | katalog: commodity, variety, growth_stage, nutrient_target, product; lampiran produk |
| `FARM` | semua peran di farm itu, termasuk WORKER | farm, customer, price_list |
| `FARM_STAFF` | ADMIN, SUPERVISOR/SELLER farm itu (bukan WORKER) | stock_discrepancy, `iam.user_account`, dan baris `GREENHOUSE` yang `greenhouse_id`-nya NULL (sale campuran, payment/void-nya) |
| `GREENHOUSE` | `iam.can_see_gh_row(farm_id, greenhouse_id)` | struktur, operasi agro, lot, stok, penjualan satu greenhouse |

`iam.user_account` tidak punya `farm_id`; farm-nya diambil dari `iam.user_farm_id()` (assignment aktif/terakhir).
User tanpa assignment (ADMIN) tidak masuk log. Pull `user_account` hanya mengembalikan `id, full_name, role`.

## 3. Mengapa kursor = `(tx_id, seq)` dengan batas `pg_snapshot_xmin`

`seq` diberikan saat INSERT, tetapi transaksi selesai dalam urutan berbeda: transaksi panjang bisa memegang
`seq = 10` dan commit setelah `seq = 11` sudah terlihat. Kursor berbasis `seq` saja akan melompati 10 selamanya.
Pull hanya mengambil baris dengan `tx_id < pg_snapshot_xmin(pg_current_snapshot())` — semua transaksi di bawah
xmin sudah selesai, jadi tidak akan ada baris baru dengan `tx_id` lebih kecil — diurutkan `(tx_id, seq)`.
Kursor klien = pasangan `(tx_id, seq)` terakhir yang diterima.

```text
SELECT seq, tx_id, table_name, row_id, op FROM sync.change_log
WHERE (tx_id, seq) > ($cursor_tx::xid8, $cursor_seq)
  AND tx_id < pg_snapshot_xmin(pg_current_snapshot())
ORDER BY tx_id, seq LIMIT 500;          -- RLS menyaring visibilitas
```

## 4. Invarian

1. Trigger `tg_sync` terpasang di **semua** tabel yang disinkron (daftar di DDL) dan **tidak** di `monitoring`,
   `site`, `audit`, `sync`, `iam` selain `user_account`.
2. UPDATE yang tidak mengubah isi baris tidak menulis log.
3. `visibility <> 'GLOBAL'` ⇒ `farm_id` terisi; `visibility = 'GREENHOUSE'` ⇒ `greenhouse_id` terisi.
4. `processed_mutation` tidak bisa diubah; `mutation_id` yang sama tidak bisa diproses dua kali (PK).

## 5. DDL

```sql
-- 0010_sync.sql
CREATE TABLE sync.change_log (
  seq bigserial PRIMARY KEY,
  tx_id xid8 NOT NULL DEFAULT pg_current_xact_id(),
  table_name text NOT NULL,
  row_id uuid NOT NULL,
  farm_id uuid,
  greenhouse_id uuid,
  visibility text NOT NULL CHECK (visibility IN ('GLOBAL', 'FARM', 'FARM_STAFF', 'GREENHOUSE')),
  op char(1) NOT NULL CHECK (op IN ('I', 'U')),
  changed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (visibility = 'GLOBAL' OR farm_id IS NOT NULL),
  CHECK (visibility <> 'GREENHOUSE' OR greenhouse_id IS NOT NULL)
);
CREATE INDEX change_log_cursor_idx ON sync.change_log (tx_id, seq);
CREATE INDEX change_log_farm_idx ON sync.change_log (farm_id, greenhouse_id);

CREATE TABLE sync.processed_mutation (
  mutation_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.user_account (id),
  device_id uuid REFERENCES iam.device (id),
  type text NOT NULL CHECK (type ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  status text NOT NULL CHECK (status IN ('APPLIED', 'REJECTED')),
  error_code text,
  result jsonb,
  processed_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'REJECTED') = (error_code IS NOT NULL))
);
CALL meta.install_kind('sync.processed_mutation', 'FACT');

-- TG_ARGV: [0] visibilitas, [1] kolom farm (default farm_id, '@user' = via assignment),
--          [2] kolom greenhouse (default greenhouse_id)
CREATE FUNCTION sync.capture_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_vis text := TG_ARGV[0];
  v_farm uuid;
  v_gh uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND v_row = to_jsonb(OLD) THEN
    RETURN NULL;
  END IF;
  IF TG_ARGV[1] = '@user' THEN
    v_farm := iam.user_farm_id(NEW.id);
  ELSIF v_vis <> 'GLOBAL' THEN
    v_farm := (v_row ->> coalesce(TG_ARGV[1], 'farm_id'))::uuid;
    v_gh := (v_row ->> coalesce(TG_ARGV[2], 'greenhouse_id'))::uuid;
  END IF;
  IF v_vis = 'GREENHOUSE' AND v_gh IS NULL THEN
    v_vis := 'FARM_STAFF';
  END IF;
  IF v_vis <> 'GLOBAL' AND v_farm IS NULL THEN
    IF TG_TABLE_NAME <> 'attachment' THEN
      RETURN NULL;
    END IF;
    v_vis := 'GLOBAL';
  END IF;
  INSERT INTO sync.change_log (table_name, row_id, farm_id, greenhouse_id, visibility, op)
  VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, NEW.id, v_farm, v_gh, v_vis, left(TG_OP, 1));
  RETURN NULL;
END $$;

CREATE PROCEDURE sync.install_capture(p_tbl regclass, VARIADIC p_args text[])
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE TRIGGER tg_sync AFTER INSERT OR UPDATE ON %s '
    'FOR EACH ROW EXECUTE FUNCTION sync.capture_change(%s)', p_tbl, meta.quote_args(p_args));
END $$;

CALL sync.install_capture('iam.user_account', 'FARM_STAFF', '@user');
CALL sync.install_capture('core.farm', 'FARM', 'id');
CALL sync.install_capture('core.greenhouse', 'GREENHOUSE', 'farm_id', 'id');
CALL sync.install_capture('core.reservoir', 'GREENHOUSE');
CALL sync.install_capture('core.block', 'GREENHOUSE');
CALL sync.install_capture('core.grow_table', 'GREENHOUSE');
CALL sync.install_capture('agro.commodity', 'GLOBAL');
CALL sync.install_capture('agro.variety', 'GLOBAL');
CALL sync.install_capture('agro.growth_stage', 'GLOBAL');
CALL sync.install_capture('agro.nutrient_target', 'GLOBAL');
CALL sync.install_capture('agro.planting_cycle', 'GREENHOUSE');
CALL sync.install_capture('agro.cycle_stage_event', 'GREENHOUSE');
CALL sync.install_capture('agro.activity', 'GREENHOUSE');
CALL sync.install_capture('agro.activity_input', 'GREENHOUSE');
CALL sync.install_capture('agro.water_check', 'GREENHOUSE');
CALL sync.install_capture('agro.task', 'GREENHOUSE');
CALL sync.install_capture('agro.issue', 'GREENHOUSE');
CALL sync.install_capture('agro.harvest', 'GREENHOUSE');
CALL sync.install_capture('inventory.product', 'GLOBAL');
CALL sync.install_capture('inventory.lot', 'GREENHOUSE');
CALL sync.install_capture('inventory.stock_movement', 'GREENHOUSE');
CALL sync.install_capture('inventory.stock_adjustment', 'GREENHOUSE');
CALL sync.install_capture('inventory.stock_discrepancy', 'FARM_STAFF');
CALL sync.install_capture('sales.customer', 'FARM');
CALL sync.install_capture('sales.price_list', 'FARM');
CALL sync.install_capture('sales.sale', 'GREENHOUSE');
CALL sync.install_capture('sales.sale_item', 'GREENHOUSE');
CALL sync.install_capture('sales.payment', 'GREENHOUSE');
CALL sync.install_capture('sales.sale_void', 'GREENHOUSE');
CALL sync.install_capture('files.attachment', 'GREENHOUSE');
CALL meta.index_foreign_keys('sync');
```
