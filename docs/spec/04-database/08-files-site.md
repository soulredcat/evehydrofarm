# 04.08 — Schema `files` & `site` (lampiran foto, website publik)

Migrasi: `0009_files_site.sql`. `files.attachment` menyimpan **metadata** foto (isi file di penyimpanan
App Pusat, ditunjuk `storage_key`). `site.inquiry` menyimpan pesan form kontak website publik.
View publik `site.v_public_*` adalah satu-satunya jalan data bisnis ke konteks `ANON`.

## 1. Tabel

`files.attachment` — STATEFUL (tanpa `archived_at`), `id` dari klien (foto dibuat offline).

| Kolom | Tipe | Aturan |
|---|---|---|
| `farm_id`, `greenhouse_id` | `uuid` NULL | disalin dari pemilik; keduanya `NULL` ⇔ `owner_type = 'PRODUCT'` (katalog global) |
| `owner_type` | `text` | `HARVEST/ACTIVITY/WATER_CHECK/ISSUE/TASK/PLANTING_CYCLE/PRODUCT` |
| `owner_id` | `uuid` | baris pemilik harus ada & terlihat oleh pembuat → `OWNER_NOT_FOUND` |
| `mime_type` | `text` | `image/jpeg`/`image/png`/`image/webp` |
| `byte_size` | `integer` | 1..10 485 760 (10 MiB) |
| `sha256` | `text` | hex 64 |
| `storage_key` | `text` UNIQUE | path relatif di penyimpanan, dibuat server |
| `status` | `text` | `PENDING_UPLOAD` → `STORED` |
| `stored_at` | `timestamptz` NULL | terisi ⇔ `STORED` |

`site.inquiry` — STATEFUL tanpa `created_by` (pengirim anonim).

| Kolom | Tipe | Aturan |
|---|---|---|
| `name` | `text` | 1..120 |
| `phone`, `email` | `text` NULL | minimal satu terisi |
| `company` | `text` NULL | ≤ 120 |
| `message` | `text` | 1..2000 |
| `status` | `text` | `NEW` → `CONTACTED` → `CLOSED` (atau `NEW` → `CLOSED`) |
| `handled_by`, `handled_at` | `uuid`, `timestamptz` NULL | terisi ⇔ bukan `NEW` |

View publik (dimiliki `eve_owner`, **bukan** `security_invoker`, `security_barrier`):

| View | Kolom | Filter |
|---|---|---|
| `site.v_public_product` | `id, code, name, grade, description, commodity_name, category, image_attachment_id, image_storage_key` | `is_published`, produk & komoditas tidak diarsip |
| `site.v_public_farm` | `id, name, city, province` | farm tidak diarsip |

## 2. Invarian

1. Lampiran hanya bisa menempel pada baris yang terlihat oleh pembuatnya (RLS pemanggil); scope disalin dari
   pemilik, tidak bisa dipalsukan (`SCOPE_MISMATCH`).
2. Kolom identitas lampiran (`owner_*`, scope, `mime_type`, `byte_size`, `sha256`, `storage_key`) beku;
   hanya `status`/`stored_at` yang berubah, sekali (`PENDING_UPLOAD>STORED`).
3. View publik tidak pernah memuat harga, stok, pelanggan, koordinat, atau data greenhouse.
   `image_storage_key` dipakai App Pusat untuk menyajikan gambar dan tidak dikirim ke browser.
4. `ANON` hanya bisa `INSERT site.inquiry` dan `SELECT` view publik (`12-rls.md`, `13-grants.md`).

## 3. DDL

```sql
-- 0009_files_site.sql
CREATE TABLE files.attachment (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  farm_id uuid REFERENCES core.farm (id),
  greenhouse_id uuid REFERENCES core.greenhouse (id),
  owner_type text NOT NULL CHECK (owner_type IN ('HARVEST', 'ACTIVITY', 'WATER_CHECK', 'ISSUE',
    'TASK', 'PLANTING_CYCLE', 'PRODUCT')),
  owner_id uuid NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key text NOT NULL UNIQUE CHECK (storage_key ~ '^[a-z0-9/._-]{8,200}$'),
  status text NOT NULL DEFAULT 'PENDING_UPLOAD' CHECK (status IN ('PENDING_UPLOAD', 'STORED')),
  stored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CHECK ((owner_type = 'PRODUCT') = (farm_id IS NULL)),
  CHECK (farm_id IS NOT NULL OR greenhouse_id IS NULL),
  CHECK ((status = 'STORED') = (stored_at IS NOT NULL))
);
CREATE INDEX attachment_owner_idx ON files.attachment (owner_type, owner_id);

CREATE TABLE site.inquiry (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  phone text CHECK (phone ~ '^\+?[0-9]{8,15}$'),
  email text CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 200),
  company text CHECK (length(company) <= 120),
  message text NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'CONTACTED', 'CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  handled_by uuid REFERENCES iam.user_account (id),
  handled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CHECK (num_nonnulls(phone, email) >= 1),
  CHECK ((status = 'NEW') = (handled_at IS NULL)),
  CHECK ((status = 'NEW') = (handled_by IS NULL))
);
CREATE INDEX inquiry_status_idx ON site.inquiry (status, created_at);

CREATE FUNCTION files.attachment_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_tbl text := CASE NEW.owner_type
    WHEN 'HARVEST' THEN 'agro.harvest' WHEN 'ACTIVITY' THEN 'agro.activity'
    WHEN 'WATER_CHECK' THEN 'agro.water_check' WHEN 'ISSUE' THEN 'agro.issue'
    WHEN 'TASK' THEN 'agro.task' WHEN 'PLANTING_CYCLE' THEN 'agro.planting_cycle'
    ELSE 'inventory.product' END;
  v_row jsonb;
BEGIN
  EXECUTE format('SELECT to_jsonb(o) FROM %s o WHERE o.id = $1', v_tbl) INTO v_row USING NEW.owner_id;
  IF v_row IS NULL THEN
    PERFORM meta.fail('OWNER_NOT_FOUND', NEW.owner_type);
  END IF;
  IF (NEW.farm_id IS NOT NULL AND NEW.farm_id IS DISTINCT FROM (v_row ->> 'farm_id')::uuid)
     OR (NEW.greenhouse_id IS NOT NULL
       AND NEW.greenhouse_id IS DISTINCT FROM (v_row ->> 'greenhouse_id')::uuid) THEN
    PERFORM meta.fail('SCOPE_MISMATCH', 'attachment');
  END IF;
  NEW.farm_id := (v_row ->> 'farm_id')::uuid;
  NEW.greenhouse_id := (v_row ->> 'greenhouse_id')::uuid;
  RETURN NEW;
END $$;

CALL meta.install_kind('files.attachment', 'STATEFUL');
CALL meta.install_kind('site.inquiry', 'STATEFUL');
CREATE TRIGGER tg_30_fill_scope BEFORE INSERT ON files.attachment
  FOR EACH ROW EXECUTE FUNCTION files.attachment_owner();
CREATE TRIGGER tg_31_freeze_scope BEFORE UPDATE ON files.attachment FOR EACH ROW
  EXECUTE FUNCTION meta.freeze_columns('farm_id', 'greenhouse_id', 'owner_type', 'owner_id',
    'mime_type', 'byte_size', 'sha256', 'storage_key', 'created_by');
CALL meta.install_transitions('files.attachment', '{PENDING_UPLOAD}', 'PENDING_UPLOAD>STORED');
CALL meta.install_transitions('site.inquiry', '{NEW}', 'NEW>CONTACTED', 'NEW>CLOSED',
  'CONTACTED>CLOSED');

CREATE VIEW site.v_public_product WITH (security_barrier = true) AS
SELECT p.id, p.code, p.name, p.grade, p.description, c.name AS commodity_name, c.category,
  img.id AS image_attachment_id, img.storage_key AS image_storage_key
FROM inventory.product p
JOIN agro.commodity c ON c.id = p.commodity_id
LEFT JOIN LATERAL (SELECT a.id, a.storage_key FROM files.attachment a
  WHERE a.owner_type = 'PRODUCT' AND a.owner_id = p.id AND a.status = 'STORED'
  ORDER BY a.stored_at DESC LIMIT 1) img ON true
WHERE p.is_published AND p.archived_at IS NULL AND c.archived_at IS NULL;

CREATE VIEW site.v_public_farm WITH (security_barrier = true) AS
SELECT f.id, f.name, f.city, f.province
FROM core.farm f
WHERE f.archived_at IS NULL;

CALL meta.index_foreign_keys('files');
CALL meta.index_foreign_keys('site');
```
