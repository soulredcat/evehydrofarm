# 04.03 — Schema `core` (struktur farm)

Migrasi: `0004_core.sql`. Hirarki fisik NFT: **Farm → Greenhouse → Blok → Meja**, ditambah
**tandon nutrisi** (`reservoir`) per greenhouse yang mengaliri satu atau lebih meja.
Semua tabel MASTER (kolom standar di `01-schemas-meta.md` §2). Hanya ADMIN/SUPERVISOR yang menulis (K-33).

## 1. Tabel

`core.farm`

| Kolom | Tipe | Aturan |
|---|---|---|
| `code` | `text` UNIQUE | `^[A-Z0-9]{1,6}$` — juga awalan nomor nota (K-35) |
| `name` | `text` | wajib |
| `address`, `city`, `province` | `text` NULL | |
| `timezone` | `text` | default `Asia/Jakarta`; `Asia/Jakarta`/`Asia/Makassar`/`Asia/Jayapura` (K-05) |
| `latitude` | `numeric(9,6)` NULL | −90..90; berpasangan dengan `longitude` |
| `longitude` | `numeric(9,6)` NULL | −180..180 |

`core.greenhouse`

| Kolom | Tipe | Aturan |
|---|---|---|
| `farm_id` | `uuid` → farm | beku setelah dibuat |
| `code` | `text` | kode pendek, unik per farm |
| `name` | `text` | wajib |
| `system_type` | `text` | default `NFT`; hanya `NFT` (K-01) |
| `area_m2` | `numeric(10,2)` NULL | > 0 |

`core.reservoir` (tandon NFT)

| Kolom | Tipe | Aturan |
|---|---|---|
| `farm_id`, `greenhouse_id` | `uuid` | `farm_id` diisi trigger dari greenhouse |
| `code` | `text` | unik per greenhouse |
| `name` | `text` | wajib |
| `capacity_l` | `integer` NULL | > 0 liter |

`core.block`

| Kolom | Tipe | Aturan |
|---|---|---|
| `farm_id`, `greenhouse_id` | `uuid` | `farm_id` diisi trigger |
| `code` | `text` | unik per greenhouse |
| `name` | `text` | wajib |
| `sort_order` | `integer` | default 0 |

`core.grow_table` (meja NFT)

| Kolom | Tipe | Aturan |
|---|---|---|
| `farm_id`, `greenhouse_id`, `block_id` | `uuid` | farm & greenhouse diisi trigger dari blok |
| `reservoir_id` | `uuid` NULL | tandon yang mengaliri; harus di greenhouse yang sama (FK komposit) |
| `code` | `text` | unik per blok |
| `name` | `text` | wajib |
| `gully_count` | `integer` | > 0 (jumlah talang) |
| `holes_per_gully` | `integer` | > 0 |
| `hole_count` | `integer` GENERATED STORED | `gully_count * holes_per_gully` |
| `length_m` | `numeric(6,2)` NULL | > 0 |

## 2. Invarian

1. Kode pendek selalu `^[A-Z0-9]{1,6}$`; unik pada tingkat induknya.
2. Kolom scope (`farm_id`, `greenhouse_id`, `block_id`) diisi dari induk dan **beku** (`IMMUTABLE_COLUMN`).
3. `UNIQUE (id, farm_id)` / `UNIQUE (id, greenhouse_id)` disediakan agar tabel lain bisa memakai
   FK komposit yang menjamin anak berada di greenhouse/farm yang sama.
4. `iam.user_assignment (greenhouse_id, farm_id)` → `core.greenhouse (id, farm_id)`: greenhouse worker
   pasti milik farm assignment-nya.
5. Tidak ada DELETE; pengarsipan lewat `archived_at`.

## 3. DDL

```sql
-- 0004_core.sql
CREATE TABLE core.farm (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{1,6}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  address text,
  city text,
  province text,
  timezone text NOT NULL DEFAULT 'Asia/Jakarta'
    CHECK (timezone IN ('Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura')),
  latitude numeric(9,6) CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) CHECK (longitude BETWEEN -180 AND 180),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);
CREATE INDEX farm_created_by_idx ON core.farm (created_by);

CREATE TABLE core.greenhouse (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9]{1,6}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  system_type text NOT NULL DEFAULT 'NFT' CHECK (system_type IN ('NFT')),
  area_m2 numeric(10,2) CHECK (area_m2 > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  UNIQUE (farm_id, code),
  UNIQUE (id, farm_id)
);
CREATE INDEX greenhouse_created_by_idx ON core.greenhouse (created_by);

CREATE TABLE core.reservoir (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  greenhouse_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9]{1,6}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  capacity_l integer CHECK (capacity_l > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  FOREIGN KEY (greenhouse_id, farm_id) REFERENCES core.greenhouse (id, farm_id),
  UNIQUE (greenhouse_id, code),
  UNIQUE (id, greenhouse_id)
);
CREATE INDEX reservoir_farm_idx ON core.reservoir (farm_id);
CREATE INDEX reservoir_gh_idx ON core.reservoir (greenhouse_id, farm_id);
CREATE INDEX reservoir_created_by_idx ON core.reservoir (created_by);

CREATE TABLE core.block (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  greenhouse_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9]{1,6}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  FOREIGN KEY (greenhouse_id, farm_id) REFERENCES core.greenhouse (id, farm_id),
  UNIQUE (greenhouse_id, code),
  UNIQUE (id, greenhouse_id)
);
CREATE INDEX block_farm_idx ON core.block (farm_id);
CREATE INDEX block_gh_idx ON core.block (greenhouse_id, farm_id);
CREATE INDEX block_created_by_idx ON core.block (created_by);

CREATE TABLE core.grow_table (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  greenhouse_id uuid NOT NULL REFERENCES core.greenhouse (id),
  block_id uuid NOT NULL,
  reservoir_id uuid,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9]{1,6}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  gully_count integer NOT NULL CHECK (gully_count > 0),
  holes_per_gully integer NOT NULL CHECK (holes_per_gully > 0),
  hole_count integer GENERATED ALWAYS AS (gully_count * holes_per_gully) STORED,
  length_m numeric(6,2) CHECK (length_m > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  FOREIGN KEY (block_id, greenhouse_id) REFERENCES core.block (id, greenhouse_id),
  FOREIGN KEY (reservoir_id, greenhouse_id) REFERENCES core.reservoir (id, greenhouse_id),
  UNIQUE (block_id, code),
  UNIQUE (id, greenhouse_id)
);
CREATE INDEX grow_table_farm_idx ON core.grow_table (farm_id);
CREATE INDEX grow_table_gh_idx ON core.grow_table (greenhouse_id);
CREATE INDEX grow_table_block_idx ON core.grow_table (block_id, greenhouse_id);
CREATE INDEX grow_table_reservoir_idx ON core.grow_table (reservoir_id, greenhouse_id);
CREATE INDEX grow_table_created_by_idx ON core.grow_table (created_by);

CALL meta.install_kind('core.farm', 'MASTER');
CALL meta.install_kind('core.greenhouse', 'MASTER');
CALL meta.install_kind('core.reservoir', 'MASTER');
CALL meta.install_kind('core.block', 'MASTER');
CALL meta.install_kind('core.grow_table', 'MASTER');
CREATE TRIGGER tg_31_freeze_scope BEFORE UPDATE ON core.greenhouse
  FOR EACH ROW EXECUTE FUNCTION meta.freeze_columns('farm_id');
CALL meta.install_scope('core.reservoir', 'core.greenhouse|greenhouse_id|farm_id');
CALL meta.install_scope('core.block', 'core.greenhouse|greenhouse_id|farm_id');
CALL meta.install_scope('core.grow_table', 'core.block|block_id|farm_id,greenhouse_id');

-- FK iam → core yang tertunda dari 02-iam.md
ALTER TABLE iam.user_assignment
  ADD CONSTRAINT user_assignment_farm_fk FOREIGN KEY (farm_id) REFERENCES core.farm (id),
  ADD CONSTRAINT user_assignment_gh_fk FOREIGN KEY (greenhouse_id, farm_id)
    REFERENCES core.greenhouse (id, farm_id);
CALL meta.index_foreign_keys('iam');
CALL meta.index_foreign_keys('core');
```

Contoh (tidak dijalankan):

```text
INSERT INTO core.grow_table (block_id, code, name, gully_count, holes_per_gully)
VALUES ('<blok B>', 'M07', 'Meja 07', 8, 20);
-- farm_id & greenhouse_id terisi dari blok, hole_count = 160.
```
