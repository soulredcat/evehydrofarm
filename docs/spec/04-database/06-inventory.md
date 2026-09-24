# 04.06 — Schema `inventory` (produk, lot, stok)

Migrasi: `0007_inventory.sql`. Stok dicatat **per lot** (satu lot = satu panen non-REJECT) sehingga asal
blok & meja setiap gram selalu tertelusur (K-24). Saldo = jumlah `stock_movement.quantity_g` (bertanda);
tidak ada kolom saldo yang di-update. Kolom standar: `01-schemas-meta.md` §2.
File ini juga menambah FK `agro.harvest.product_id` dan pemeriksaan produk panen (tertunda dari `05`).

## 1. Tabel

`inventory.product` — MASTER global (katalog jual, juga sumber katalog website).

| Kolom | Tipe | Aturan |
|---|---|---|
| `commodity_id` | `uuid` → commodity | beku; `UNIQUE (commodity_id, grade)` |
| `grade` | `text` | `A`/`B`/`C`/`REJECT`; beku |
| `code` | `text` UNIQUE | `^[A-Z0-9_-]{2,24}$` |
| `name`, `description` | `text`, `text` NULL | |
| `unit` | `text` | selalu `KG` (satuan tampilan; simpan tetap gram) |
| `is_sellable` | `boolean` | `REJECT` ⇒ `false` |
| `is_published` | `boolean` | tampil di website publik; hanya bila `is_sellable` |

`inventory.lot` — STATEFUL, `id` & `lot_code` dari klien, dibuat service dalam transaksi yang sama dengan panen.

| Kolom | Tipe | Aturan |
|---|---|---|
| `farm_id`, `greenhouse_id`, `block_id`, `grow_table_id`, `cycle_id` | `uuid` | dari panen |
| `harvest_id` | `uuid` UNIQUE → harvest | panen grade `REJECT` tidak boleh punya lot |
| `product_id`, `harvested_at` | `uuid`, `timestamptz` | dari panen |
| `lot_code` | `text` UNIQUE | `^[A-Z0-9-]{4,40}$` |
| `initial_weight_g` | `integer` | = `harvest.weight_g` |
| `status` | `text` | `AVAILABLE`/`QUARANTINED`/`DISCARDED`; panen `phi_violation` ⇒ dipaksa `QUARANTINED` |
| `status_reason` | `text` NULL | wajib bila bukan `AVAILABLE` |

`inventory.stock_movement` — FACT.

| Kolom | Tipe | Aturan |
|---|---|---|
| `farm_id`, `greenhouse_id`, `product_id` | `uuid` | dari lot |
| `lot_id` | `uuid` → lot | |
| `type` | `text` | `HARVEST_IN/SALE_OUT/SALE_VOID_IN/ADJUSTMENT_IN/ADJUSTMENT_OUT/DISCARD_OUT` |
| `quantity_g` | `integer` | `*_IN` > 0, `*_OUT` < 0 |
| `occurred_at` | `timestamptz` | waktu kejadian |
| `ref_type`, `ref_id` | `text`, `uuid` | `HARVEST`/`SALE_ITEM`/`STOCK_ADJUSTMENT`/`LOT` sesuai `type`; `UNIQUE (type, ref_id)` |

`inventory.stock_adjustment` — STATEFUL (R-05): `lot_id`, `farm_id`, `greenhouse_id`, `direction IN/OUT`,
`quantity_g > 0`, `reason SHRINKAGE/DAMAGE/WEIGH_DIFF/OTHER`, `notes`, `requested_at`,
`status PENDING/APPROVED/REJECTED`, `decided_by`, `decided_at`, `decision_notes`.

`inventory.stock_discrepancy` — STATEFUL (R-01): `lot_id`, `farm_id`, `greenhouse_id`, `sale_id` NULL
(FK di `07`), `shortfall_g > 0`, `detected_at`, `status OPEN/RESOLVED`, `resolved_by`, `resolved_at`, `resolution_notes`.

View `inventory.v_lot_balance` (`security_invoker`): `lot_id, farm_id, greenhouse_id, block_id,
grow_table_id, product_id, status, balance_g`.

## 2. Invarian

1. Produk panen cocok: `product.commodity_id = variety.commodity_id` dan `product.grade = harvest.grade` → `PRODUCT_MISMATCH`.
2. Pada COMMIT: setiap panen non-`REJECT` punya tepat satu lot (`LOT_MISSING`); setiap lot punya tepat satu
   `HARVEST_IN` sebesar `initial_weight_g` (`LOT_MOVEMENT_MISSING`).
3. Lot cocok dengan panennya (scope, produk, waktu, berat) → `SCOPE_MISMATCH` / `LOT_HARVEST_MISMATCH`;
   panen `REJECT` → `NO_LOT_FOR_REJECT`.
4. Setiap pergerakan menunjuk sumber yang sah (`MOVEMENT_REF_INVALID`): `HARVEST_IN` → panen lot itu;
   `SALE_OUT/SALE_VOID_IN` → `sale_item` lot itu dengan berat sama (item harus di-INSERT lebih dulu);
   `ADJUSTMENT_*` → penyesuaian `APPROVED` lot itu, arah & jumlah sama; `DISCARD_OUT` → `ref_id = lot_id`.
5. Saldo boleh negatif (R-01, penjualan offline). Service membuat `stock_discrepancy`; database tidak menolak.
6. Lot `DISCARDED` pada COMMIT bersaldo ≤ 0 (service menulis `DISCARD_OUT` sisa saldo) → `LOT_BALANCE_NOT_ZERO`.
7. Penyesuaian boleh dibuat langsung `APPROVED` hanya dalam konteks SUPERVISOR (R-05) → `FORBIDDEN`;
   penyesuaian `APPROVED` pada COMMIT punya tepat satu pergerakan `ADJUSTMENT_*` → `ADJUSTMENT_MOVEMENT_MISSING`.
8. Transisi: lot `AVAILABLE<>QUARANTINED`, keduanya `>DISCARDED`; penyesuaian `PENDING>APPROVED|REJECTED`;
   selisih `OPEN>RESOLVED`.

## 3. DDL

```sql
-- 0007_inventory.sql
CREATE TABLE inventory.product (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  commodity_id uuid NOT NULL REFERENCES agro.commodity (id),
  grade text NOT NULL CHECK (grade IN ('A', 'B', 'C', 'REJECT')),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  unit text NOT NULL DEFAULT 'KG' CHECK (unit = 'KG'),
  is_sellable boolean NOT NULL DEFAULT true,
  is_published boolean NOT NULL DEFAULT false,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  UNIQUE (commodity_id, grade),
  CHECK (grade <> 'REJECT' OR NOT is_sellable),
  CHECK (NOT is_published OR is_sellable)
);

ALTER TABLE agro.harvest ADD CONSTRAINT harvest_product_fk
  FOREIGN KEY (product_id) REFERENCES inventory.product (id);

CREATE TABLE inventory.lot (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  greenhouse_id uuid NOT NULL REFERENCES core.greenhouse (id),
  block_id uuid NOT NULL REFERENCES core.block (id),
  grow_table_id uuid NOT NULL REFERENCES core.grow_table (id),
  cycle_id uuid NOT NULL REFERENCES agro.planting_cycle (id),
  harvest_id uuid NOT NULL UNIQUE REFERENCES agro.harvest (id),
  product_id uuid NOT NULL REFERENCES inventory.product (id),
  lot_code text NOT NULL UNIQUE CHECK (lot_code ~ '^[A-Z0-9-]{4,40}$'),
  harvested_at timestamptz NOT NULL,
  initial_weight_g integer NOT NULL CHECK (initial_weight_g > 0),
  status text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'QUARANTINED', 'DISCARDED')),
  status_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CHECK (status = 'AVAILABLE' OR status_reason IS NOT NULL)
);
CREATE INDEX lot_gh_status_idx ON inventory.lot (greenhouse_id, status);

CREATE TABLE inventory.stock_movement (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  greenhouse_id uuid NOT NULL REFERENCES core.greenhouse (id),
  lot_id uuid NOT NULL REFERENCES inventory.lot (id),
  product_id uuid NOT NULL REFERENCES inventory.product (id),
  type text NOT NULL CHECK (type IN ('HARVEST_IN', 'SALE_OUT', 'SALE_VOID_IN',
    'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DISCARD_OUT')),
  quantity_g integer NOT NULL,
  occurred_at timestamptz NOT NULL,
  ref_type text NOT NULL,
  ref_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  device_id uuid REFERENCES iam.device (id),
  UNIQUE (type, ref_id),
  CHECK (CASE WHEN type IN ('HARVEST_IN', 'SALE_VOID_IN', 'ADJUSTMENT_IN')
    THEN quantity_g > 0 ELSE quantity_g < 0 END),
  CHECK (ref_type = CASE type WHEN 'HARVEST_IN' THEN 'HARVEST' WHEN 'DISCARD_OUT' THEN 'LOT'
    WHEN 'SALE_OUT' THEN 'SALE_ITEM' WHEN 'SALE_VOID_IN' THEN 'SALE_ITEM'
    ELSE 'STOCK_ADJUSTMENT' END),
  CHECK (type <> 'DISCARD_OUT' OR ref_id = lot_id)
);
CREATE INDEX stock_movement_ref_idx ON inventory.stock_movement (ref_id);

CREATE TABLE inventory.stock_adjustment (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  lot_id uuid NOT NULL REFERENCES inventory.lot (id),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  greenhouse_id uuid NOT NULL REFERENCES core.greenhouse (id),
  direction text NOT NULL CHECK (direction IN ('IN', 'OUT')),
  quantity_g integer NOT NULL CHECK (quantity_g > 0),
  reason text NOT NULL CHECK (reason IN ('SHRINKAGE', 'DAMAGE', 'WEIGH_DIFF', 'OTHER')),
  notes text,
  requested_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  decided_by uuid REFERENCES iam.user_account (id),
  decided_at timestamptz,
  decision_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CHECK ((status = 'PENDING') = (decided_at IS NULL)),
  CHECK ((status = 'PENDING') = (decided_by IS NULL))
);

CREATE TABLE inventory.stock_discrepancy (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  lot_id uuid NOT NULL REFERENCES inventory.lot (id),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  greenhouse_id uuid NOT NULL REFERENCES core.greenhouse (id),
  sale_id uuid,
  shortfall_g integer NOT NULL CHECK (shortfall_g > 0),
  detected_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
  resolved_by uuid REFERENCES iam.user_account (id),
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL AND resolved_by IS NOT NULL))
);

CREATE VIEW inventory.v_lot_balance WITH (security_invoker = true) AS
SELECT l.id AS lot_id, l.farm_id, l.greenhouse_id, l.block_id, l.grow_table_id, l.product_id,
  l.status, coalesce(sum(m.quantity_g), 0)::bigint AS balance_g
FROM inventory.lot l
LEFT JOIN inventory.stock_movement m ON m.lot_id = l.id
GROUP BY l.id;

-- aturan khusus
CREATE FUNCTION inventory.harvest_product_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM inventory.product p JOIN agro.variety v ON v.id = NEW.variety_id
      WHERE p.id = NEW.product_id AND p.commodity_id = v.commodity_id AND p.grade = NEW.grade) THEN
    PERFORM meta.fail('PRODUCT_MISMATCH');
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION inventory.lot_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  h agro.harvest%ROWTYPE;
BEGIN
  SELECT * INTO h FROM agro.harvest WHERE id = NEW.harvest_id;
  IF h.grade = 'REJECT' THEN
    PERFORM meta.fail('NO_LOT_FOR_REJECT');
  END IF;
  IF NEW.initial_weight_g IS DISTINCT FROM h.weight_g THEN
    PERFORM meta.fail('LOT_HARVEST_MISMATCH', 'initial_weight_g');
  END IF;
  IF h.phi_violation THEN
    NEW.status := 'QUARANTINED';
    NEW.status_reason := 'PHI_ACTIVE';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION inventory.movement_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_ok boolean;
BEGIN
  v_ok := CASE NEW.type
    WHEN 'HARVEST_IN' THEN EXISTS (SELECT 1 FROM inventory.lot l
      WHERE l.id = NEW.lot_id AND l.harvest_id = NEW.ref_id)
    WHEN 'DISCARD_OUT' THEN true
    WHEN 'ADJUSTMENT_IN' THEN EXISTS (SELECT 1 FROM inventory.stock_adjustment a
      WHERE a.id = NEW.ref_id AND a.lot_id = NEW.lot_id AND a.status = 'APPROVED'
        AND a.direction = 'IN' AND a.quantity_g = NEW.quantity_g)
    WHEN 'ADJUSTMENT_OUT' THEN EXISTS (SELECT 1 FROM inventory.stock_adjustment a
      WHERE a.id = NEW.ref_id AND a.lot_id = NEW.lot_id AND a.status = 'APPROVED'
        AND a.direction = 'OUT' AND a.quantity_g = -NEW.quantity_g)
    ELSE EXISTS (SELECT 1 FROM sales.sale_item i
      WHERE i.id = NEW.ref_id AND i.lot_id = NEW.lot_id AND i.weight_g = abs(NEW.quantity_g)) END;
  IF NOT v_ok THEN
    PERFORM meta.fail('MOVEMENT_REF_INVALID', NEW.type);
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION inventory.adjustment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'APPROVED' AND iam.ctx_role() IS DISTINCT FROM 'SUPERVISOR'
     AND iam.ctx_role() IS NOT NULL THEN
    PERFORM meta.fail('FORBIDDEN', 'direct approval');
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION inventory.assert_movements() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'harvest' THEN
    IF NEW.grade <> 'REJECT' AND NOT EXISTS (SELECT 1 FROM inventory.lot l
        WHERE l.harvest_id = NEW.id) THEN
      PERFORM meta.fail('LOT_MISSING', NEW.id::text);
    END IF;
  ELSIF TG_TABLE_NAME = 'lot' AND TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM inventory.stock_movement m WHERE m.type = 'HARVEST_IN'
        AND m.ref_id = NEW.harvest_id AND m.lot_id = NEW.id
        AND m.quantity_g = NEW.initial_weight_g) THEN
      PERFORM meta.fail('LOT_MOVEMENT_MISSING', NEW.id::text);
    END IF;
  ELSIF TG_TABLE_NAME = 'lot' THEN
    IF EXISTS (SELECT 1 FROM inventory.v_lot_balance b WHERE b.lot_id = NEW.id
        AND b.status = 'DISCARDED' AND b.balance_g > 0) THEN
      PERFORM meta.fail('LOT_BALANCE_NOT_ZERO', NEW.id::text);
    END IF;
  ELSIF EXISTS (SELECT 1 FROM inventory.stock_adjustment a WHERE a.id = NEW.id
      AND a.status = 'APPROVED') AND NOT EXISTS (SELECT 1 FROM inventory.stock_movement m
      WHERE m.ref_id = NEW.id AND m.type = 'ADJUSTMENT_' || NEW.direction) THEN
    PERFORM meta.fail('ADJUSTMENT_MOVEMENT_MISSING', NEW.id::text);
  END IF;
  RETURN NULL;
END $$;

-- pemasangan trigger
CALL meta.install_kind('inventory.product', 'MASTER');
CALL meta.install_kind('inventory.lot', 'STATEFUL');
CALL meta.install_kind('inventory.stock_movement', 'FACT');
CALL meta.install_kind('inventory.stock_adjustment', 'STATEFUL');
CALL meta.install_kind('inventory.stock_discrepancy', 'STATEFUL');
CREATE TRIGGER tg_31_freeze_scope BEFORE UPDATE ON inventory.product
  FOR EACH ROW EXECUTE FUNCTION meta.freeze_columns('commodity_id', 'grade');
CALL meta.install_scope('inventory.lot', 'agro.harvest|harvest_id|farm_id,greenhouse_id,block_id,'
  'grow_table_id,cycle_id,product_id,harvested_at');
CALL meta.install_scope('inventory.stock_movement',
  'inventory.lot|lot_id|farm_id,greenhouse_id,product_id');
CALL meta.install_scope('inventory.stock_adjustment', 'inventory.lot|lot_id|farm_id,greenhouse_id');
CALL meta.install_scope('inventory.stock_discrepancy', 'inventory.lot|lot_id|farm_id,greenhouse_id');
CALL meta.install_transitions('inventory.lot', '{AVAILABLE,QUARANTINED}', 'AVAILABLE>QUARANTINED',
  'AVAILABLE>DISCARDED', 'QUARANTINED>AVAILABLE', 'QUARANTINED>DISCARDED');
CALL meta.install_transitions('inventory.stock_adjustment', '{PENDING,APPROVED}',
  'PENDING>APPROVED', 'PENDING>REJECTED');
CALL meta.install_transitions('inventory.stock_discrepancy', '{OPEN}', 'OPEN>RESOLVED');

CREATE TRIGGER tg_42_product BEFORE INSERT ON agro.harvest
  FOR EACH ROW EXECUTE FUNCTION inventory.harvest_product_check();
CREATE TRIGGER tg_40_check BEFORE INSERT ON inventory.lot
  FOR EACH ROW EXECUTE FUNCTION inventory.lot_check();
CREATE TRIGGER tg_40_ref BEFORE INSERT ON inventory.stock_movement
  FOR EACH ROW EXECUTE FUNCTION inventory.movement_check();
CREATE TRIGGER tg_40_guard BEFORE INSERT ON inventory.stock_adjustment
  FOR EACH ROW EXECUTE FUNCTION inventory.adjustment_guard();
CREATE CONSTRAINT TRIGGER tg_c1_lot AFTER INSERT ON agro.harvest
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory.assert_movements();
CREATE CONSTRAINT TRIGGER tg_c1_movement AFTER INSERT OR UPDATE ON inventory.lot
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory.assert_movements();
CREATE CONSTRAINT TRIGGER tg_c1_movement AFTER INSERT OR UPDATE ON inventory.stock_adjustment
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory.assert_movements();
CALL meta.index_foreign_keys('agro');
CALL meta.index_foreign_keys('inventory');
```

Urutan tulis service untuk "Panen" (tidak dijalankan):

```text
INSERT agro.harvest (id, cycle_id, product_id, grade, weight_g, harvested_at)        -- phi_violation dihitung
INSERT inventory.lot (id, harvest_id, lot_code, initial_weight_g)                    -- QUARANTINED bila PHI
INSERT inventory.stock_movement (lot_id, type='HARVEST_IN', quantity_g, ref_type='HARVEST', ref_id=harvest.id)
COMMIT  -- constraint trigger tertunda memeriksa kelengkapan
```
