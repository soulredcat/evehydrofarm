# 04.07 — Schema `sales` (pelanggan, harga, penjualan, pembayaran, void)

Migrasi: `0008_sales.sql`. Penjualan append-only (K-32): tidak pernah diedit, koreksi lewat `sale_void`
(R-04). Setiap baris jual menunjuk **satu lot**, sehingga blok & meja asal tersalin ke `sale_item` (K-24).
Kolom standar: `01-schemas-meta.md` §2. File ini juga menambah FK `inventory.stock_discrepancy.sale_id`.

## 1. Tabel

`sales.customer` — MASTER per farm, `id` boleh dari klien (worker membuat pelanggan cepat offline).

| Kolom | Tipe | Aturan |
|---|---|---|
| `farm_id` | `uuid` → farm | beku |
| `name` | `text` | 1–120 |
| `type` | `text` | `MARKET_TRADER/RESTAURANT/RETAIL/WHOLESALER/HOUSEHOLD/OTHER` |
| `phone`, `address`, `notes` | `text` NULL | `phone` `^\+?[0-9]{8,15}$` |
| `is_walk_in` | `boolean` | pelanggan "Umum"; maks satu per farm |

`sales.price_list` — FACT per farm: `farm_id`, `product_id`, `price_per_kg bigint > 0`, `effective_from date`;
`UNIQUE (farm_id, product_id, effective_from)`. Harga berlaku = baris `effective_from` terbaru ≤ hari ini
(view `sales.v_current_price`, memakai `current_date` sesi — App Pusat menyetel `TimeZone` sesuai farm).

`sales.sale` — FACT, `id` dari klien.

| Kolom | Tipe | Aturan |
|---|---|---|
| `sale_no` | `text` UNIQUE | K-35 `{KODEFARM}-{KODEPERANGKAT}-{YYMMDD}-{NNN}`; awalan = `farm.code`, bagian 2 = `device.device_code` bila `device_id` terisi |
| `farm_id` | `uuid` | wajib |
| `greenhouse_id` | `uuid` NULL | greenhouse bersama semua item; `NULL` bila campuran (dicek saat COMMIT) |
| `customer_id` | `uuid` | pelanggan farm yang sama (FK komposit) |
| `sold_at` | `timestamptz` | waktu perangkat |
| `payment_terms`, `due_on` | `text`, `date` NULL | `CASH`/`CREDIT`; `due_on` wajib ⇔ `CREDIT` |
| `subtotal`, `discount` | `bigint` | ≥ 0; `discount ≤ subtotal`; `subtotal = Σ line_total` (COMMIT) |
| `total` | `bigint` GENERATED | `subtotal - discount` |
| `notes` | `text` NULL | |

`sales.sale_item` — FACT.

| Kolom | Tipe | Aturan |
|---|---|---|
| `sale_id` | `uuid` → sale | farm sama dengan lot |
| `farm_id`, `greenhouse_id`, `block_id`, `grow_table_id`, `product_id` | `uuid` | **disalin dari lot** ("Blok B · Meja 07") |
| `lot_id` | `uuid` → lot | lot harus `AVAILABLE` → `LOT_NOT_SELLABLE` |
| `weight_g` | `integer` | > 0 |
| `price_per_kg` | `bigint` | > 0, harga yang dipakai |
| `list_price_per_kg` | `bigint` NULL | harga daftar saat jual |
| `price_overridden` | `boolean` GENERATED | daftar terisi dan berbeda (R-03) |
| `line_total` | `bigint` GENERATED | `(weight_g * price_per_kg + 500) / 1000` (pembulatan rupiah terdekat) |

`sales.payment` — FACT: `farm_id`, `greenhouse_id` NULL (dari sale), `sale_id`, `amount bigint > 0`,
`method CASH/TRANSFER/QRIS`, `paid_at`, `reference`, `notes`. Penjualan yang sudah di-void → `SALE_VOIDED`.

`sales.sale_void` — STATEFUL: `sale_id`, `farm_id`, `greenhouse_id` NULL, `reason`, `requested_at`,
`status PENDING/APPROVED/REJECTED`, `decided_by`, `decided_at`, `decision_notes`.

View `sales.v_sale_summary` (`security_invoker`): `sale_id, farm_id, greenhouse_id, customer_id, sold_at,
payment_terms, due_on, total, paid, outstanding, payment_status UNPAID/PARTIAL/PAID/OVERPAID, is_voided`.

## 2. Invarian

1. Pada COMMIT: sale punya ≥ 1 item (`SALE_EMPTY`), `subtotal = Σ line_total` (`SALE_TOTAL_MISMATCH`),
   `greenhouse_id` = greenhouse bersama item atau `NULL` bila campuran (`SALE_SCOPE_MISMATCH`).
2. Pada COMMIT: tiap `sale_item` punya tepat satu `SALE_OUT` (`lot_id` sama, `-weight_g`) → `SALE_MOVEMENT_MISSING`.
3. Void: maks satu `PENDING` dan satu `APPROVED` per sale. Void `APPROVED` pada COMMIT → setiap item punya
   `SALE_VOID_IN` (`VOID_MOVEMENT_MISSING`); sebaliknya `SALE_VOID_IN` hanya boleh untuk sale ber-void `APPROVED`.
4. Void boleh dibuat langsung `APPROVED` hanya oleh SUPERVISOR; WORKER hanya mengajukan void untuk sale buatannya
   (`FORBIDDEN`). Transisi `PENDING>APPROVED|REJECTED`.
5. Lot yang dikarantina setelah penjualan offline terjadi tetap menolak item itu (`LOT_NOT_SELLABLE`) — service
   mengembalikan mutasi sebagai `REJECTED` (lihat `06-sinkronisasi.md`).
6. Pembayaran boleh melebihi total (status `OVERPAID`); tidak ada pengembalian uang di sistem.

## 3. DDL

```sql
-- 0008_sales.sql
CREATE TABLE sales.customer (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  type text NOT NULL CHECK (type IN ('MARKET_TRADER', 'RESTAURANT', 'RETAIL', 'WHOLESALER',
    'HOUSEHOLD', 'OTHER')),
  phone text CHECK (phone ~ '^\+?[0-9]{8,15}$'),
  address text,
  notes text,
  is_walk_in boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  UNIQUE (id, farm_id)
);
CREATE UNIQUE INDEX customer_one_walk_in ON sales.customer (farm_id) WHERE is_walk_in;

CREATE TABLE sales.price_list (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  product_id uuid NOT NULL REFERENCES inventory.product (id),
  price_per_kg bigint NOT NULL CHECK (price_per_kg > 0),
  effective_from date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  device_id uuid REFERENCES iam.device (id),
  UNIQUE (farm_id, product_id, effective_from)
);

CREATE TABLE sales.sale (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  sale_no text NOT NULL UNIQUE CHECK (sale_no ~ '^[A-Z0-9]{1,6}-[A-Z2-7]{4,6}-[0-9]{6}-[0-9]{3,}$'),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  greenhouse_id uuid,
  customer_id uuid NOT NULL,
  sold_at timestamptz NOT NULL,
  payment_terms text NOT NULL CHECK (payment_terms IN ('CASH', 'CREDIT')),
  due_on date,
  subtotal bigint NOT NULL CHECK (subtotal >= 0),
  discount bigint NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total bigint GENERATED ALWAYS AS (subtotal - discount) STORED,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  device_id uuid REFERENCES iam.device (id),
  FOREIGN KEY (customer_id, farm_id) REFERENCES sales.customer (id, farm_id),
  FOREIGN KEY (greenhouse_id, farm_id) REFERENCES core.greenhouse (id, farm_id),
  CHECK (discount <= subtotal),
  CHECK ((payment_terms = 'CREDIT') = (due_on IS NOT NULL))
);
CREATE INDEX sale_farm_time_idx ON sales.sale (farm_id, sold_at);

CREATE TABLE sales.sale_item (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  sale_id uuid NOT NULL REFERENCES sales.sale (id),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  greenhouse_id uuid NOT NULL REFERENCES core.greenhouse (id),
  lot_id uuid NOT NULL REFERENCES inventory.lot (id),
  product_id uuid NOT NULL REFERENCES inventory.product (id),
  block_id uuid NOT NULL REFERENCES core.block (id),
  grow_table_id uuid NOT NULL REFERENCES core.grow_table (id),
  weight_g integer NOT NULL CHECK (weight_g > 0),
  price_per_kg bigint NOT NULL CHECK (price_per_kg > 0),
  list_price_per_kg bigint CHECK (list_price_per_kg > 0),
  price_overridden boolean
    GENERATED ALWAYS AS (coalesce(list_price_per_kg <> price_per_kg, false)) STORED,
  line_total bigint GENERATED ALWAYS AS ((weight_g::bigint * price_per_kg + 500) / 1000) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  device_id uuid REFERENCES iam.device (id)
);

CREATE TABLE sales.payment (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  greenhouse_id uuid REFERENCES core.greenhouse (id),
  sale_id uuid NOT NULL REFERENCES sales.sale (id),
  amount bigint NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('CASH', 'TRANSFER', 'QRIS')),
  paid_at timestamptz NOT NULL,
  reference text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  device_id uuid REFERENCES iam.device (id)
);

CREATE TABLE sales.sale_void (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  sale_id uuid NOT NULL REFERENCES sales.sale (id),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  greenhouse_id uuid REFERENCES core.greenhouse (id),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
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
CREATE UNIQUE INDEX sale_void_one_pending ON sales.sale_void (sale_id) WHERE status = 'PENDING';
CREATE UNIQUE INDEX sale_void_one_approved ON sales.sale_void (sale_id) WHERE status = 'APPROVED';

ALTER TABLE inventory.stock_discrepancy ADD CONSTRAINT stock_discrepancy_sale_fk
  FOREIGN KEY (sale_id) REFERENCES sales.sale (id);

CREATE VIEW sales.v_current_price WITH (security_invoker = true) AS
SELECT DISTINCT ON (p.farm_id, p.product_id) p.farm_id, p.product_id, p.price_per_kg, p.effective_from
FROM sales.price_list p
WHERE p.effective_from <= current_date
ORDER BY p.farm_id, p.product_id, p.effective_from DESC;

CREATE VIEW sales.v_sale_summary WITH (security_invoker = true) AS
SELECT s.id AS sale_id, s.farm_id, s.greenhouse_id, s.customer_id, s.sold_at, s.payment_terms,
  s.due_on, s.total, p.paid,
  CASE WHEN v.is_voided THEN 0 ELSE greatest(s.total - p.paid, 0) END AS outstanding,
  CASE WHEN p.paid = 0 AND s.total > 0 THEN 'UNPAID' WHEN p.paid < s.total THEN 'PARTIAL'
    WHEN p.paid = s.total THEN 'PAID' ELSE 'OVERPAID' END AS payment_status,
  v.is_voided
FROM sales.sale s
CROSS JOIN LATERAL (SELECT coalesce(sum(x.amount), 0)::bigint AS paid
  FROM sales.payment x WHERE x.sale_id = s.id) p
CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM sales.sale_void d
  WHERE d.sale_id = s.id AND d.status = 'APPROVED') AS is_voided) v;

-- aturan khusus
CREATE FUNCTION sales.sale_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF split_part(NEW.sale_no, '-', 1) IS DISTINCT FROM
       (SELECT f.code FROM core.farm f WHERE f.id = NEW.farm_id)
     OR (NEW.device_id IS NOT NULL AND split_part(NEW.sale_no, '-', 2) IS DISTINCT FROM
       (SELECT d.device_code FROM iam.device d WHERE d.id = NEW.device_id)) THEN
    PERFORM meta.fail('SALE_NO_INVALID', NEW.sale_no);
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION sales.item_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM inventory.lot l WHERE l.id = NEW.lot_id AND l.status = 'AVAILABLE') THEN
    PERFORM meta.fail('LOT_NOT_SELLABLE', NEW.lot_id::text);
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION sales.payment_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM sales.sale_void d WHERE d.sale_id = NEW.sale_id AND d.status = 'APPROVED') THEN
    PERFORM meta.fail('SALE_VOIDED');
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION sales.void_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'APPROVED' AND iam.ctx_role() IS DISTINCT FROM 'SUPERVISOR'
     AND iam.ctx_role() IS NOT NULL THEN
    PERFORM meta.fail('FORBIDDEN', 'direct approval');
  END IF;
  IF iam.ctx_role() = 'WORKER' AND NOT EXISTS (SELECT 1 FROM sales.sale s
      WHERE s.id = NEW.sale_id AND s.created_by = iam.ctx_user_id()) THEN
    PERFORM meta.fail('FORBIDDEN', 'void other sale');
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION sales.assert_sale() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_n bigint;
  v_sum bigint;
  v_gh uuid;
BEGIN
  IF TG_TABLE_NAME = 'sale' THEN
    SELECT count(*), sum(i.line_total), CASE WHEN count(DISTINCT i.greenhouse_id) = 1
      THEN min(i.greenhouse_id::text)::uuid END
    INTO v_n, v_sum, v_gh FROM sales.sale_item i WHERE i.sale_id = NEW.id;
    IF v_n = 0 THEN
      PERFORM meta.fail('SALE_EMPTY', NEW.sale_no);
    ELSIF v_sum <> NEW.subtotal THEN
      PERFORM meta.fail('SALE_TOTAL_MISMATCH', NEW.sale_no);
    ELSIF v_gh IS DISTINCT FROM NEW.greenhouse_id THEN
      PERFORM meta.fail('SALE_SCOPE_MISMATCH', NEW.sale_no);
    END IF;
  ELSIF TG_TABLE_NAME = 'sale_item' THEN
    IF (SELECT count(*) FROM inventory.stock_movement m WHERE m.type = 'SALE_OUT'
        AND m.ref_id = NEW.id AND m.lot_id = NEW.lot_id AND m.quantity_g = -NEW.weight_g) <> 1 THEN
      PERFORM meta.fail('SALE_MOVEMENT_MISSING', NEW.id::text);
    END IF;
  ELSIF TG_TABLE_NAME = 'sale_void' THEN
    IF EXISTS (SELECT 1 FROM sales.sale_void d WHERE d.id = NEW.id AND d.status = 'APPROVED')
       AND EXISTS (SELECT 1 FROM sales.sale_item i WHERE i.sale_id = NEW.sale_id
         AND NOT EXISTS (SELECT 1 FROM inventory.stock_movement m
           WHERE m.type = 'SALE_VOID_IN' AND m.ref_id = i.id)) THEN
      PERFORM meta.fail('VOID_MOVEMENT_MISSING', NEW.id::text);
    END IF;
  ELSIF NEW.type = 'SALE_VOID_IN' AND NOT EXISTS (SELECT 1 FROM sales.sale_item i
      JOIN sales.sale_void d ON d.sale_id = i.sale_id AND d.status = 'APPROVED'
      WHERE i.id = NEW.ref_id) THEN
    PERFORM meta.fail('MOVEMENT_REF_INVALID', 'SALE_VOID_IN without approved void');
  END IF;
  RETURN NULL;
END $$;

-- pemasangan trigger
CALL meta.install_kind('sales.customer', 'MASTER');
CALL meta.install_kind('sales.price_list', 'FACT');
CALL meta.install_kind('sales.sale', 'FACT');
CALL meta.install_kind('sales.sale_item', 'FACT');
CALL meta.install_kind('sales.payment', 'FACT');
CALL meta.install_kind('sales.sale_void', 'STATEFUL');
CREATE TRIGGER tg_31_freeze_scope BEFORE UPDATE ON sales.customer
  FOR EACH ROW EXECUTE FUNCTION meta.freeze_columns('farm_id');
CALL meta.install_scope('sales.sale_item',
  'inventory.lot|lot_id|farm_id,greenhouse_id,block_id,grow_table_id,product_id',
  'sales.sale|sale_id|farm_id');
CALL meta.install_scope('sales.payment', 'sales.sale|sale_id|farm_id,greenhouse_id');
CALL meta.install_scope('sales.sale_void', 'sales.sale|sale_id|farm_id,greenhouse_id');
CALL meta.install_transitions('sales.sale_void', '{PENDING,APPROVED}',
  'PENDING>APPROVED', 'PENDING>REJECTED');

CREATE TRIGGER tg_40_check BEFORE INSERT ON sales.sale
  FOR EACH ROW EXECUTE FUNCTION sales.sale_check();
CREATE TRIGGER tg_40_check BEFORE INSERT ON sales.sale_item
  FOR EACH ROW EXECUTE FUNCTION sales.item_check();
CREATE TRIGGER tg_40_check BEFORE INSERT ON sales.payment
  FOR EACH ROW EXECUTE FUNCTION sales.payment_check();
CREATE TRIGGER tg_40_guard BEFORE INSERT ON sales.sale_void
  FOR EACH ROW EXECUTE FUNCTION sales.void_guard();
CREATE CONSTRAINT TRIGGER tg_c1_items AFTER INSERT ON sales.sale
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sales.assert_sale();
CREATE CONSTRAINT TRIGGER tg_c1_movement AFTER INSERT ON sales.sale_item
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sales.assert_sale();
CREATE CONSTRAINT TRIGGER tg_c1_movement AFTER INSERT OR UPDATE ON sales.sale_void
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sales.assert_sale();
CREATE CONSTRAINT TRIGGER tg_c2_void AFTER INSERT ON inventory.stock_movement
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sales.assert_sale();
CALL meta.index_foreign_keys('inventory');
CALL meta.index_foreign_keys('sales');
```
