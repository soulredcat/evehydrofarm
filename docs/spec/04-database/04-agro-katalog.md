# 04.04 — Schema `agro`: Katalog Tanaman (global)

Migrasi: `0005_agro_catalog.sql`. Katalog **global** (tanpa `farm_id`): terlihat oleh semua peran,
hanya ADMIN yang menulis (matriks `03-peran-akses.md` §3). Semua tabel MASTER.
Isi awal (cabai, tomat, sayur daun — K-02) dibuat oleh seed (`14-seed.md`), bukan migrasi.

## 1. Tabel

`agro.commodity`

| Kolom | Tipe | Aturan |
|---|---|---|
| `code` | `text` UNIQUE | `^[A-Z0-9_]{2,16}$` (mis. `CHILI`, `TOMATO`, `LETTUCE`) |
| `name` | `text` | wajib (Bahasa Indonesia, mis. "Cabai") |
| `category` | `text` | `FRUIT_VEG`/`LEAFY_VEG`/`HERB` |

`agro.variety`

| Kolom | Tipe | Aturan |
|---|---|---|
| `commodity_id` | `uuid` → commodity | beku |
| `code` | `text` | `^[A-Z0-9_]{2,16}$`, unik per komoditas (mis. `RAWIT`) |
| `name` | `text` | wajib |
| `days_to_transplant` | `smallint` | ≥ 0 (0 = semai langsung di meja) |
| `days_to_first_harvest` | `smallint` | > 0, dihitung dari tanggal semai |
| `harvest_window_days` | `smallint` | ≥ 0 (lama periode panen; 0 = panen sekali, sayur daun) |
| `notes` | `text` NULL | |

`agro.growth_stage`

| Kolom | Tipe | Aturan |
|---|---|---|
| `commodity_id` | `uuid` → commodity | beku |
| `code` | `text` | `NURSERY`/`VEGETATIVE`/`FLOWERING`/`FRUITING`/`HARVEST`; unik per komoditas |
| `name` | `text` | wajib |
| `sort_order` | `smallint` | ≥ 0; unik per komoditas |
| `typical_days` | `smallint` NULL | > 0 |

`agro.nutrient_target` — satu target per tahap tumbuh.

| Kolom | Tipe | Aturan |
|---|---|---|
| `commodity_id` | `uuid` | harus sama dengan komoditas tahap (FK komposit) |
| `growth_stage_id` | `uuid` UNIQUE | → growth_stage |
| `ph_min`, `ph_max` | `numeric(4,2)` | 0..14, `min < max` |
| `ec_min_ms`, `ec_max_ms` | `numeric(4,2)` | mS/cm, 0..20, `min < max` |
| `water_temp_min_c`, `water_temp_max_c` | `numeric(4,1)` | °C, 0..50, `min < max` |

## 2. Invarian

1. `variety.code` unik per komoditas; `growth_stage (commodity_id, code)` dan `(commodity_id, sort_order)` unik.
2. `nutrient_target.commodity_id` = komoditas dari `growth_stage_id` (FK komposit ke `growth_stage (id, commodity_id)`).
3. Semua pasangan min/max: `min < max`.
4. Komoditas buah (`FRUIT_VEG`) memakai tahap `FLOWERING`/`FRUITING`; sayur daun cukup
   `NURSERY → VEGETATIVE → HARVEST`. Ini aturan data seed, bukan constraint.
5. `commodity_id` pada varietas/tahap beku (siklus tanam lama bergantung padanya).

## 3. DDL

```sql
-- 0005_agro_catalog.sql
CREATE TABLE agro.commodity (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_]{2,16}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  category text NOT NULL CHECK (category IN ('FRUIT_VEG', 'LEAFY_VEG', 'HERB')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz
);
CREATE INDEX commodity_created_by_idx ON agro.commodity (created_by);

CREATE TABLE agro.variety (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  commodity_id uuid NOT NULL REFERENCES agro.commodity (id),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_]{2,16}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  days_to_transplant smallint NOT NULL DEFAULT 0 CHECK (days_to_transplant >= 0),
  days_to_first_harvest smallint NOT NULL CHECK (days_to_first_harvest > 0),
  harvest_window_days smallint NOT NULL DEFAULT 0 CHECK (harvest_window_days >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  UNIQUE (commodity_id, code),
  UNIQUE (id, commodity_id),
  CHECK (days_to_first_harvest > days_to_transplant)
);
CREATE INDEX variety_created_by_idx ON agro.variety (created_by);

CREATE TABLE agro.growth_stage (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  commodity_id uuid NOT NULL REFERENCES agro.commodity (id),
  code text NOT NULL
    CHECK (code IN ('NURSERY', 'VEGETATIVE', 'FLOWERING', 'FRUITING', 'HARVEST')),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  sort_order smallint NOT NULL CHECK (sort_order >= 0),
  typical_days smallint CHECK (typical_days > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  UNIQUE (commodity_id, code),
  UNIQUE (commodity_id, sort_order),
  UNIQUE (id, commodity_id)
);
CREATE INDEX growth_stage_created_by_idx ON agro.growth_stage (created_by);

CREATE TABLE agro.nutrient_target (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  commodity_id uuid NOT NULL REFERENCES agro.commodity (id),
  growth_stage_id uuid NOT NULL UNIQUE,
  ph_min numeric(4,2) NOT NULL CHECK (ph_min BETWEEN 0 AND 14),
  ph_max numeric(4,2) NOT NULL CHECK (ph_max BETWEEN 0 AND 14),
  ec_min_ms numeric(4,2) NOT NULL CHECK (ec_min_ms BETWEEN 0 AND 20),
  ec_max_ms numeric(4,2) NOT NULL CHECK (ec_max_ms BETWEEN 0 AND 20),
  water_temp_min_c numeric(4,1) NOT NULL CHECK (water_temp_min_c BETWEEN 0 AND 50),
  water_temp_max_c numeric(4,1) NOT NULL CHECK (water_temp_max_c BETWEEN 0 AND 50),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  FOREIGN KEY (growth_stage_id, commodity_id) REFERENCES agro.growth_stage (id, commodity_id),
  CHECK (ph_min < ph_max),
  CHECK (ec_min_ms < ec_max_ms),
  CHECK (water_temp_min_c < water_temp_max_c)
);
CREATE INDEX nutrient_target_commodity_idx ON agro.nutrient_target (commodity_id);
CREATE INDEX nutrient_target_stage_idx ON agro.nutrient_target (growth_stage_id, commodity_id);
CREATE INDEX nutrient_target_created_by_idx ON agro.nutrient_target (created_by);

CALL meta.install_kind('agro.commodity', 'MASTER');
CALL meta.install_kind('agro.variety', 'MASTER');
CALL meta.install_kind('agro.growth_stage', 'MASTER');
CALL meta.install_kind('agro.nutrient_target', 'MASTER');
CREATE TRIGGER tg_31_freeze_scope BEFORE UPDATE ON agro.variety
  FOR EACH ROW EXECUTE FUNCTION meta.freeze_columns('commodity_id');
CREATE TRIGGER tg_31_freeze_scope BEFORE UPDATE ON agro.growth_stage
  FOR EACH ROW EXECUTE FUNCTION meta.freeze_columns('commodity_id', 'code');
CREATE TRIGGER tg_31_freeze_scope BEFORE UPDATE ON agro.nutrient_target
  FOR EACH ROW EXECUTE FUNCTION meta.freeze_columns('commodity_id', 'growth_stage_id');
CALL meta.index_foreign_keys('agro');
```

Contoh data (seed, tidak dijalankan):

```text
commodity  CHILI  "Cabai"  FRUIT_VEG
variety    CHILI/RAWIT  days_to_transplant=21  days_to_first_harvest=90  harvest_window_days=60
stage      CHILI/FRUITING  sort_order=3  → nutrient_target ph 5.8–6.5, EC 2.5–3.5, air 20–26 °C
```
