# 04.12 — Row Level Security

Migrasi: `0013_rls_policies.sql`. Lapis kedua penegakan akses (K-26): walau App Pusat salah, database
tidak membuka baris di luar cakupan. Semua tabel bisnis `ENABLE` **dan** `FORCE ROW LEVEL SECURITY`.
Tidak ada policy `DELETE` di mana pun (DELETE juga dicegah trigger). Konteks & fungsi: `02-iam.md`.
`eve_owner` punya `BYPASSRLS` (migrasi, seed, fungsi `SECURITY DEFINER`); `eve_api` & `eve_monitoring` tidak.

## 1. Prosedur `meta.apply_policies`

`meta.apply_policies(tbl, kind, insert_roles[], update_roles[], write_pred)` mengaktifkan + memaksa RLS lalu membuat:

| Policy | Perintah | Ekspresi |
|---|---|---|
| `<tabel>_select` | SELECT | `pred(kind)` |
| `<tabel>_insert` | INSERT | `WITH CHECK (write_pred AND ctx_role() = ANY(insert_roles))` — hanya bila daftar tidak kosong |
| `<tabel>_update` | UPDATE | `USING` & `WITH CHECK` sama dengan di atas, peran `update_roles` |

`write_pred` default = `pred(kind)`. `WITH CHECK` dievaluasi **setelah** trigger BEFORE, jadi kolom scope yang
diisi `fill_scope` ikut diperiksa.

| `kind` | `pred` |
|---|---|
| `GLOBAL` | `ctx_role() IN (ADMIN, SUPERVISOR, SELLER, WORKER)` |
| `FARM` / `FARM_SELF` | `can_see_farm_row(farm_id)` / `can_see_farm_row(id)` |
| `GH` / `GH_SELF` | `can_see_gh_row(farm_id, greenhouse_id)` / `can_see_gh_row(farm_id, id)` |
| `FARM_STAFF` | ADMIN, atau SUPERVISOR/SELLER dengan `farm_id = ctx_farm_id()` |
| `GH_DEVICE` | `GH` atau (`ctx_role()='DEVICE'` dan farm & greenhouse = konteks) |
| lainnya | teks dianggap ekspresi SQL mentah |

## 2. Matriks policy (ringkas; sumber: `03-peran-akses.md` §3)

| Tabel | SELECT | INSERT | UPDATE |
|---|---|---|---|
| `iam.user_account` | `can_see_user(id)` | ADMIN; SUPERVISOR (peran W/S, `created_by`=saya) | diri sendiri atau `can_manage_user` (+ guard kolom) |
| `iam.user_assignment` | milik sendiri; ADMIN; SUPERVISOR farm-nya | ADMIN; SUPERVISOR farm-nya + `can_manage_user` | sama dengan INSERT |
| `iam.device`, `iam.refresh_token` | milik sendiri atau `can_see_user`/`can_manage_user` | hanya milik sendiri | milik sendiri; pengelola boleh mencabut |
| `core.farm` | FARM_SELF | ADMIN | ADMIN |
| `core.greenhouse` / reservoir, block, grow_table | GH_SELF / GH | ADMIN, SUPERVISOR | ADMIN, SUPERVISOR |
| katalog agro, `inventory.product` | GLOBAL | ADMIN | ADMIN |
| `planting_cycle` | GH | SUPERVISOR, WORKER | SUPERVISOR, WORKER |
| `cycle_stage_event`, `activity`, `activity_input`, `water_check`, `harvest` | GH | SUPERVISOR, WORKER | — |
| `task` / `issue` | GH | SUPERVISOR / SUPERVISOR, WORKER | SUPERVISOR, WORKER / SUPERVISOR |
| `lot` | GH | SUPERVISOR, WORKER | SUPERVISOR |
| `stock_movement` | GH | SUPERVISOR, SELLER, WORKER | — |
| `stock_adjustment` | GH | SUPERVISOR, SELLER, WORKER | SUPERVISOR |
| `stock_discrepancy` | FARM_STAFF | SUPERVISOR, SELLER, WORKER (cek GH) | SUPERVISOR |
| `customer` / `price_list` | FARM | SUPERVISOR, SELLER, WORKER / ADMIN, SUPERVISOR | SUPERVISOR, SELLER / — |
| `sale`, `sale_item`, `payment` | GH (sale campuran: bukan WORKER) | SUPERVISOR, SELLER, WORKER | — |
| `sale_void` | GH | SUPERVISOR, SELLER, WORKER | SUPERVISOR |
| `files.attachment` | produk: GLOBAL; lainnya GH | semua peran login (produk: ADMIN) | sama |
| `site.inquiry` | ADMIN | **ANON** | ADMIN |
| `sync.change_log` | aturan visibilitas `09-sync.md` §2 | — (trigger) | — |
| `sync.processed_mutation` | `user_id = ctx_user_id()` | semua peran login, milik sendiri | — |
| `audit.audit_log` | ADMIN; SUPERVISOR farm-nya | — (trigger) | — |
| `monitoring.device` | GH_DEVICE | ADMIN, SUPERVISOR | ADMIN, SUPERVISOR, DEVICE (kolom dibatasi trigger) |
| `monitoring.sensor`, `threshold` | GH_DEVICE | ADMIN, SUPERVISOR | ADMIN, SUPERVISOR |
| `monitoring.reading` | GH_DEVICE | DEVICE | — |
| `monitoring.alert` | GH_DEVICE | DEVICE | ADMIN, SUPERVISOR, WORKER, DEVICE (kolom dibatasi trigger) |

## 3. Invarian

1. Konteks kosong (`ctx_role() IS NULL`) → setiap `pred` bernilai false → 0 baris, INSERT/UPDATE ditolak.
2. `ANON` hanya lolos `site.inquiry_insert`; data publik lain hanya lewat view `site.v_public_*` (`08`).
3. `INSERT ... RETURNING` butuh baris baru lolos SELECT: `site.inquiry` (ANON) dan `stock_discrepancy` (WORKER)
   harus di-INSERT **tanpa** `RETURNING`.
4. Fungsi di policy yang membaca `iam` bersifat `SECURITY DEFINER` → tidak ada rekursi policy.

## 4. DDL

```sql
-- 0013_rls_policies.sql
CREATE PROCEDURE meta.apply_policies(p_tbl regclass, p_kind text, p_insert text[] DEFAULT '{}',
  p_update text[] DEFAULT '{}', p_write text DEFAULT NULL)
LANGUAGE plpgsql AS $$
DECLARE
  v_gh text := 'iam.can_see_gh_row(farm_id, greenhouse_id)';
  v_pred text := CASE p_kind
    WHEN 'GLOBAL' THEN 'iam.ctx_role() IN (''ADMIN'', ''SUPERVISOR'', ''SELLER'', ''WORKER'')'
    WHEN 'FARM' THEN 'iam.can_see_farm_row(farm_id)'
    WHEN 'FARM_SELF' THEN 'iam.can_see_farm_row(id)'
    WHEN 'GH' THEN v_gh
    WHEN 'GH_SELF' THEN 'iam.can_see_gh_row(farm_id, id)'
    WHEN 'FARM_STAFF' THEN '(iam.ctx_role() = ''ADMIN'' OR (iam.ctx_role() IN (''SUPERVISOR'', '
      '''SELLER'') AND farm_id = iam.ctx_farm_id()))'
    WHEN 'GH_DEVICE' THEN '(' || v_gh || ' OR (iam.ctx_role() = ''DEVICE'' AND farm_id = '
      'iam.ctx_farm_id() AND greenhouse_id = iam.ctx_greenhouse_id()))'
    ELSE p_kind END;
  v_write text := coalesce(p_write, v_pred);
  v_name text := (SELECT c.relname FROM pg_class c WHERE c.oid = p_tbl);
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', p_tbl);
  EXECUTE format('CREATE POLICY %I ON %s FOR SELECT USING (%s)', v_name || '_select', p_tbl, v_pred);
  IF cardinality(p_insert) > 0 THEN
    EXECUTE format('CREATE POLICY %I ON %s FOR INSERT WITH CHECK ((%s) AND iam.ctx_role() = ANY (%L))',
      v_name || '_insert', p_tbl, v_write, p_insert);
  END IF;
  IF cardinality(p_update) > 0 THEN
    EXECUTE format('CREATE POLICY %I ON %s FOR UPDATE USING ((%s) AND iam.ctx_role() = ANY (%L)) '
      'WITH CHECK ((%s) AND iam.ctx_role() = ANY (%L))',
      v_name || '_update', p_tbl, v_write, p_update, v_write, p_update);
  END IF;
END $$;

-- iam
CALL meta.apply_policies('iam.user_account', 'iam.can_see_user(id)', '{ADMIN,SUPERVISOR}', '{}',
  '(iam.ctx_role() = ''ADMIN'' OR (role IN (''WORKER'', ''SELLER'') AND created_by = iam.ctx_user_id()))');
CREATE POLICY user_account_update ON iam.user_account FOR UPDATE
  USING (id = iam.ctx_user_id() OR iam.can_manage_user(id))
  WITH CHECK (id = iam.ctx_user_id() OR iam.can_manage_user(id));
CALL meta.apply_policies('iam.user_assignment', '(user_id = iam.ctx_user_id() OR iam.ctx_role() = '
  '''ADMIN'' OR (iam.ctx_role() = ''SUPERVISOR'' AND farm_id = iam.ctx_farm_id()))',
  '{ADMIN,SUPERVISOR}', '{ADMIN,SUPERVISOR}', '(iam.ctx_role() = ''ADMIN'' OR (farm_id = '
  'iam.ctx_farm_id() AND iam.can_manage_user(user_id)))');
CALL meta.apply_policies('iam.device', '(user_id = iam.ctx_user_id() OR iam.can_see_user(user_id))',
  '{ADMIN,SUPERVISOR,SELLER,WORKER}', '{ADMIN,SUPERVISOR,SELLER,WORKER}', 'user_id = iam.ctx_user_id()');
CREATE POLICY device_revoke ON iam.device FOR UPDATE
  USING (iam.can_manage_user(user_id)) WITH CHECK (iam.can_manage_user(user_id));
CALL meta.apply_policies('iam.refresh_token',
  '(user_id = iam.ctx_user_id() OR iam.can_manage_user(user_id))',
  '{ADMIN,SUPERVISOR,SELLER,WORKER}', '{ADMIN,SUPERVISOR,SELLER,WORKER}', 'user_id = iam.ctx_user_id()');
CREATE POLICY refresh_token_revoke ON iam.refresh_token FOR UPDATE
  USING (iam.can_manage_user(user_id)) WITH CHECK (iam.can_manage_user(user_id));

-- core & katalog
CALL meta.apply_policies('core.farm', 'FARM_SELF', '{ADMIN}', '{ADMIN}');
CALL meta.apply_policies('core.greenhouse', 'GH_SELF', '{ADMIN,SUPERVISOR}', '{ADMIN,SUPERVISOR}');
CALL meta.apply_policies('core.reservoir', 'GH', '{ADMIN,SUPERVISOR}', '{ADMIN,SUPERVISOR}');
CALL meta.apply_policies('core.block', 'GH', '{ADMIN,SUPERVISOR}', '{ADMIN,SUPERVISOR}');
CALL meta.apply_policies('core.grow_table', 'GH', '{ADMIN,SUPERVISOR}', '{ADMIN,SUPERVISOR}');
CALL meta.apply_policies('agro.commodity', 'GLOBAL', '{ADMIN}', '{ADMIN}');
CALL meta.apply_policies('agro.variety', 'GLOBAL', '{ADMIN}', '{ADMIN}');
CALL meta.apply_policies('agro.growth_stage', 'GLOBAL', '{ADMIN}', '{ADMIN}');
CALL meta.apply_policies('agro.nutrient_target', 'GLOBAL', '{ADMIN}', '{ADMIN}');
CALL meta.apply_policies('inventory.product', 'GLOBAL', '{ADMIN}', '{ADMIN}');

-- operasi agro
CALL meta.apply_policies('agro.planting_cycle', 'GH', '{SUPERVISOR,WORKER}', '{SUPERVISOR,WORKER}');
CALL meta.apply_policies('agro.cycle_stage_event', 'GH', '{SUPERVISOR,WORKER}');
CALL meta.apply_policies('agro.activity', 'GH', '{SUPERVISOR,WORKER}');
CALL meta.apply_policies('agro.activity_input', 'GH', '{SUPERVISOR,WORKER}');
CALL meta.apply_policies('agro.water_check', 'GH', '{SUPERVISOR,WORKER}');
CALL meta.apply_policies('agro.harvest', 'GH', '{SUPERVISOR,WORKER}');
CALL meta.apply_policies('agro.task', 'GH', '{SUPERVISOR}', '{SUPERVISOR,WORKER}');
CALL meta.apply_policies('agro.issue', 'GH', '{SUPERVISOR,WORKER}', '{SUPERVISOR}');

-- stok & penjualan
CALL meta.apply_policies('inventory.lot', 'GH', '{SUPERVISOR,WORKER}', '{SUPERVISOR}');
CALL meta.apply_policies('inventory.stock_movement', 'GH', '{SUPERVISOR,SELLER,WORKER}');
CALL meta.apply_policies('inventory.stock_adjustment', 'GH', '{SUPERVISOR,SELLER,WORKER}',
  '{SUPERVISOR}');
CALL meta.apply_policies('inventory.stock_discrepancy', 'FARM_STAFF', '{SUPERVISOR,SELLER,WORKER}',
  '{SUPERVISOR}', 'iam.can_see_gh_row(farm_id, greenhouse_id)');
CALL meta.apply_policies('sales.customer', 'FARM', '{SUPERVISOR,SELLER,WORKER}', '{SUPERVISOR,SELLER}');
CALL meta.apply_policies('sales.price_list', 'FARM', '{ADMIN,SUPERVISOR}');
CALL meta.apply_policies('sales.sale', 'GH', '{SUPERVISOR,SELLER,WORKER}');
CALL meta.apply_policies('sales.sale_item', 'GH', '{SUPERVISOR,SELLER,WORKER}');
CALL meta.apply_policies('sales.payment', 'GH', '{SUPERVISOR,SELLER,WORKER}');
CALL meta.apply_policies('sales.sale_void', 'GH', '{SUPERVISOR,SELLER,WORKER}', '{SUPERVISOR}');

-- lampiran, website, sync, audit
CALL meta.apply_policies('files.attachment', '(CASE WHEN farm_id IS NULL THEN iam.ctx_role() IN '
  '(''ADMIN'', ''SUPERVISOR'', ''SELLER'', ''WORKER'') ELSE iam.can_see_gh_row(farm_id, '
  'greenhouse_id) END)', '{ADMIN,SUPERVISOR,SELLER,WORKER}', '{ADMIN,SUPERVISOR,SELLER,WORKER}',
  '(CASE WHEN farm_id IS NULL THEN iam.ctx_role() = ''ADMIN'' '
  'ELSE iam.can_see_gh_row(farm_id, greenhouse_id) END)');
CALL meta.apply_policies('site.inquiry', 'iam.ctx_role() = ''ADMIN''', '{ANON}', '{ADMIN}', 'true');
CALL meta.apply_policies('sync.change_log', '(CASE visibility '
  'WHEN ''GLOBAL'' THEN iam.ctx_role() IN (''ADMIN'', ''SUPERVISOR'', ''SELLER'', ''WORKER'') '
  'WHEN ''FARM'' THEN iam.can_see_farm_row(farm_id) '
  'WHEN ''FARM_STAFF'' THEN iam.ctx_role() = ''ADMIN'' OR (iam.ctx_role() IN (''SUPERVISOR'', '
  '''SELLER'') AND farm_id = iam.ctx_farm_id()) '
  'ELSE iam.can_see_gh_row(farm_id, greenhouse_id) END)');
CALL meta.apply_policies('sync.processed_mutation', 'user_id = iam.ctx_user_id()',
  '{ADMIN,SUPERVISOR,SELLER,WORKER}');
CALL meta.apply_policies('audit.audit_log', '(iam.ctx_role() = ''ADMIN'' OR (iam.ctx_role() = '
  '''SUPERVISOR'' AND farm_id = iam.ctx_farm_id()))');

-- monitoring
CALL meta.apply_policies('monitoring.device', 'GH_DEVICE', '{ADMIN,SUPERVISOR}',
  '{ADMIN,SUPERVISOR,DEVICE}');
CALL meta.apply_policies('monitoring.sensor', 'GH_DEVICE', '{ADMIN,SUPERVISOR}', '{ADMIN,SUPERVISOR}');
CALL meta.apply_policies('monitoring.threshold', 'GH_DEVICE', '{ADMIN,SUPERVISOR}',
  '{ADMIN,SUPERVISOR}');
CALL meta.apply_policies('monitoring.reading', 'GH_DEVICE', '{DEVICE}');
CALL meta.apply_policies('monitoring.alert', 'GH_DEVICE', '{DEVICE}',
  '{ADMIN,SUPERVISOR,WORKER,DEVICE}');
```
