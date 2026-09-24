# 04.10 — Schema `audit` (log audit)

Migrasi: `0011_audit.sql`. Setiap INSERT/UPDATE pada tabel MASTER, STATEFUL, dan semua tabel `iam`
direkam oleh trigger `audit.capture()` beserta pelaku (dari konteks RLS) dan isi baris sebelum/sesudah.
Tabel FACT tidak diaudit: isinya sendiri sudah catatan permanen (append-only, `created_by`).

## 1. Tabel

`audit.audit_log` — append-only; ditulis hanya oleh `audit.capture()` (`SECURITY DEFINER`).

| Kolom | Tipe | Aturan |
|---|---|---|
| `id` | `bigserial` PK | |
| `occurred_at` | `timestamptz` | default `now()` (waktu transaksi) |
| `actor_user_id` | `uuid` NULL | `iam.ctx_user_id()`; NULL untuk seed/login/perangkat. **Tanpa FK** agar audit tidak pernah menggagalkan penulisan bisnis |
| `actor_role` | `text` NULL | `iam.ctx_role()` |
| `action` | `text` | `INSERT`/`UPDATE` |
| `table_name` | `text` | `schema.table` |
| `row_id` | `uuid` | `id` baris |
| `farm_id`, `greenhouse_id` | `uuid` NULL | scope baris (dasar RLS SUPERVISOR) |
| `before`, `after` | `jsonb` NULL | tanpa `password_hash`, `token_hash`, `device_key_hash` |

## 2. Aturan `audit.capture()`

`TG_ARGV[0]` = kolom farm (default `farm_id`; `@kolom` = farm dari assignment user di `kolom`, lewat
`iam.user_farm_id`), `TG_ARGV[1]` = kolom greenhouse (default `greenhouse_id`). Kolom yang tidak ada → NULL.
UPDATE yang tidak mengubah isi baris tidak dicatat.

| Tabel | Farm dari |
|---|---|
| `iam.user_account` | `@id` |
| `iam.user_assignment` | `farm_id` |
| `iam.device`, `iam.refresh_token` | `@user_id` |
| `core.farm` / `core.greenhouse` | `id` / `farm_id` (+ greenhouse `id`) |
| tabel lain | `farm_id`, `greenhouse_id` (NULL untuk katalog global & `site.inquiry` → hanya ADMIN yang melihat) |

Monitoring (`device`, `sensor`, `threshold`) dipasang di `11-monitoring.md`. `monitoring.alert` tidak diaudit
(berubah tiap pembacaan sensor).

## 3. Invarian

1. `audit_log` tidak bisa di-UPDATE/DELETE (`APPEND_ONLY`); `eve_api`/`eve_monitoring` tidak punya hak INSERT.
2. Rahasia (`password_hash`, `token_hash`, `device_key_hash`) tidak pernah masuk `before`/`after`.
3. RLS (`12-rls.md`): ADMIN melihat semua; SUPERVISOR hanya `farm_id = farm saya`; peran lain tidak melihat apa pun.

## 4. DDL

```sql
-- 0011_audit.sql
CREATE TABLE audit.audit_log (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  actor_role text,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE')),
  table_name text NOT NULL,
  row_id uuid NOT NULL,
  farm_id uuid,
  greenhouse_id uuid,
  before jsonb,
  after jsonb
);
CREATE INDEX audit_log_row_idx ON audit.audit_log (table_name, row_id);
CREATE INDEX audit_log_farm_time_idx ON audit.audit_log (farm_id, occurred_at);
CALL meta.install_kind('audit.audit_log', 'FACT');

CREATE FUNCTION audit.capture() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_secret text[] := ARRAY['password_hash', 'token_hash', 'device_key_hash'];
  v_new jsonb := to_jsonb(NEW) - v_secret;
  v_old jsonb;
  v_farm_col text := coalesce(TG_ARGV[0], 'farm_id');
  v_farm uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD) - v_secret;
    IF v_old = v_new AND to_jsonb(OLD) = to_jsonb(NEW) THEN
      RETURN NULL;
    END IF;
  END IF;
  IF left(v_farm_col, 1) = '@' THEN
    v_farm := iam.user_farm_id((to_jsonb(NEW) ->> substr(v_farm_col, 2))::uuid);
  ELSE
    v_farm := (v_new ->> v_farm_col)::uuid;
  END IF;
  INSERT INTO audit.audit_log (actor_user_id, actor_role, action, table_name, row_id,
    farm_id, greenhouse_id, before, after)
  VALUES (iam.ctx_user_id(), iam.ctx_role(), TG_OP, TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, NEW.id,
    v_farm, (v_new ->> coalesce(TG_ARGV[1], 'greenhouse_id'))::uuid, v_old, v_new);
  RETURN NULL;
END $$;

CREATE PROCEDURE audit.install_capture(p_tbl regclass, VARIADIC p_args text[] DEFAULT '{}')
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE TRIGGER tg_audit AFTER INSERT OR UPDATE ON %s '
    'FOR EACH ROW EXECUTE FUNCTION audit.capture(%s)', p_tbl, meta.quote_args(p_args));
END $$;

CALL audit.install_capture('iam.user_account', '@id');
CALL audit.install_capture('iam.user_assignment');
CALL audit.install_capture('iam.device', '@user_id');
CALL audit.install_capture('iam.refresh_token', '@user_id');
CALL audit.install_capture('core.farm', 'id');
CALL audit.install_capture('core.greenhouse', 'farm_id', 'id');
CALL audit.install_capture('core.reservoir');
CALL audit.install_capture('core.block');
CALL audit.install_capture('core.grow_table');
CALL audit.install_capture('agro.commodity');
CALL audit.install_capture('agro.variety');
CALL audit.install_capture('agro.growth_stage');
CALL audit.install_capture('agro.nutrient_target');
CALL audit.install_capture('agro.planting_cycle');
CALL audit.install_capture('agro.task');
CALL audit.install_capture('agro.issue');
CALL audit.install_capture('inventory.product');
CALL audit.install_capture('inventory.lot');
CALL audit.install_capture('inventory.stock_adjustment');
CALL audit.install_capture('inventory.stock_discrepancy');
CALL audit.install_capture('sales.customer');
CALL audit.install_capture('sales.sale_void');
CALL audit.install_capture('files.attachment');
CALL audit.install_capture('site.inquiry');
```

Contoh pembacaan (tidak dijalankan):

```text
SELECT occurred_at, actor_role, action, before ->> 'status' AS dari, after ->> 'status' AS ke
FROM audit.audit_log WHERE table_name = 'inventory.lot' AND row_id = $1 ORDER BY id;
```
