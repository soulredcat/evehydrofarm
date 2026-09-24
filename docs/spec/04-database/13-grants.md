# 04.13 — Hak Akses Role (GRANT)

Migrasi: `0014_grants.sql`. Role cluster dibuat oleh `pnpm db:setup`, bukan migrasi (konvensi §7):
`eve_owner LOGIN BYPASSRLS` (pemilik semua objek), `eve_api LOGIN NOBYPASSRLS`,
`eve_monitoring LOGIN NOBYPASSRLS`, `eve_readonly LOGIN NOBYPASSRLS`. Hak di sini melengkapi RLS (`12`):
GRANT menentukan **tabel/kolom apa** yang boleh disentuh role, RLS menentukan **baris mana**.

## 1. Ringkasan

| Objek | `eve_api` | `eve_monitoring` | `eve_readonly` |
|---|---|---|---|
| `core, agro, inventory, sales, files, site` (tabel) | `SELECT, INSERT, UPDATE` | `core`: `SELECT` | `SELECT` |
| view (`inventory.v_*`, `sales.v_*`, `site.v_public_*`) | `SELECT` | — | `SELECT` |
| `iam.user_account` | `INSERT`; `SELECT`/`UPDATE` semua kolom **kecuali** `password_hash` | `SELECT (id, full_name, role)` | `SELECT` kecuali `password_hash` |
| `iam.refresh_token` | `INSERT`; `SELECT` kecuali `token_hash`; `UPDATE (used_at, revoked_at, replaced_by)` | — | `SELECT` kecuali `token_hash` |
| `iam.user_assignment`, `iam.device` | `SELECT, INSERT, UPDATE` | — | `SELECT` |
| `sync.change_log` / `sync.processed_mutation` | `SELECT` / `SELECT, INSERT` | — | `SELECT` |
| `audit.audit_log` | `SELECT` | — | `SELECT` |
| `monitoring.*` | `SELECT` (tanpa `device_key_hash`) | `SELECT, INSERT, UPDATE` (tanpa baca `device_key_hash`) | `SELECT` kecuali `device_key_hash` |
| `meta.schema_migration` | — | — | `SELECT` |
| sequence (`change_log_seq_seq`, `audit_log_id_seq`) | — (hanya dipakai fungsi DEFINER) | — | `SELECT` |

Tidak ada `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` untuk role aplikasi; tidak ada `CREATE` pada schema
mana pun (tanpa hak DDL). `INSERT/UPDATE` hanya diberikan pada **tabel** (relkind `r`), tidak pernah pada view:
view publik dimiliki `eve_owner` (BYPASSRLS) dan bisa di-update otomatis, sehingga hak tulis di view = bocor RLS.

## 2. Fungsi

Semua fungsi & prosedur di schema aplikasi: `REVOKE EXECUTE ... FROM PUBLIC`, lalu diberikan per kebutuhan.
Fungsi trigger tidak butuh `EXECUTE` saat trigger berjalan; yang dipanggil **dari dalam** fungsi trigger
berhak pemanggil (`meta.fail`, `iam.ctx_*`, `iam.is_worker_of_gh`) atau dari policy RLS tetap butuh `EXECUTE`.

| Fungsi | `eve_api` | `eve_monitoring` | `eve_readonly` |
|---|---|---|---|
| `meta.fail` | ✓ | ✓ | — |
| `iam.ctx_*`, `iam.can_see_farm_row`, `iam.can_see_gh_row` | ✓ | ✓ | ✓ |
| `iam.can_see_user`, `iam.can_manage_user`, `iam.user_farm_id` (DEFINER) | ✓ | ✓ | ✓ |
| `iam.is_worker_of_gh` (DEFINER) | ✓ | — | — |
| `iam.auth_lookup`, `auth_scope`, `auth_set_password`, `auth_find_refresh` (DEFINER) | ✓ | — | — |
| `monitoring.device_auth` (DEFINER) | — | ✓ | — |
| prosedur `meta.*`, `sync.install_capture`, `audit.install_capture` | — | — | — |

`ALTER DEFAULT PRIVILEGES FOR ROLE eve_owner REVOKE EXECUTE ON ROUTINES FROM PUBLIC` memastikan fungsi di
migrasi berikutnya juga tertutup sampai diberikan eksplisit. Migrasi yang menambah tabel wajib menambah GRANT-nya.

## 3. Invarian

1. `eve_api` tidak bisa membaca `password_hash`, `token_hash`, `device_key_hash` lewat query biasa;
   verifikasi login hanya lewat `iam.auth_lookup` / `iam.auth_find_refresh`.
2. `eve_api` tidak bisa menulis `monitoring.*`; `eve_monitoring` tidak bisa menulis schema selain `monitoring`
   (trigger audit berjalan sebagai pemilik).
3. `eve_readonly` tetap tunduk RLS: tanpa `set_config` konteks ia melihat 0 baris tabel bisnis.
4. Karena hak kolom, `eve_api` tidak boleh memakai `RETURNING *` / `SELECT *` pada `iam.user_account` dan
   `iam.refresh_token`; sebutkan kolom secara eksplisit.

## 4. DDL

```sql
-- 0014_grants.sql
CREATE PROCEDURE meta.grant_relations(p_schemas text[], p_privs text, p_role text,
  p_kinds "char"[] DEFAULT '{r}')
LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT c.oid::regclass AS rel FROM pg_class c
    WHERE c.relnamespace::regnamespace::text = ANY (p_schemas) AND c.relkind = ANY (p_kinds)
  LOOP
    EXECUTE format('GRANT %s ON %s TO %I', p_privs, r.rel, p_role);
  END LOOP;
END $$;

CREATE PROCEDURE meta.grant_columns_except(p_tbl regclass, p_priv text, p_role text, p_except text[])
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('GRANT %s (%s) ON %s TO %I', p_priv,
    (SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) FROM pg_attribute a
     WHERE a.attrelid = p_tbl AND a.attnum > 0 AND NOT a.attisdropped
       AND a.attname <> ALL (p_except)), p_tbl, p_role);
END $$;

-- schema
GRANT USAGE ON SCHEMA meta, iam, core, agro, inventory, sales, files, site, sync, audit, monitoring
  TO eve_api, eve_readonly;
GRANT USAGE ON SCHEMA meta, iam, core, monitoring TO eve_monitoring;

-- eve_api
CALL meta.grant_relations('{core,agro,inventory,sales,files,site}', 'SELECT, INSERT, UPDATE', 'eve_api');
CALL meta.grant_relations('{inventory,sales,site}', 'SELECT', 'eve_api', '{v}');
GRANT SELECT, INSERT, UPDATE ON iam.user_assignment, iam.device TO eve_api;
GRANT INSERT ON iam.user_account, iam.refresh_token TO eve_api;
CALL meta.grant_columns_except('iam.user_account', 'SELECT', 'eve_api', '{password_hash}');
CALL meta.grant_columns_except('iam.user_account', 'UPDATE', 'eve_api',
  '{id,password_hash,created_at,created_by}');
CALL meta.grant_columns_except('iam.refresh_token', 'SELECT', 'eve_api', '{token_hash}');
GRANT UPDATE (used_at, revoked_at, replaced_by) ON iam.refresh_token TO eve_api;
GRANT SELECT ON sync.change_log, audit.audit_log TO eve_api;
GRANT SELECT, INSERT ON sync.processed_mutation TO eve_api;
GRANT SELECT ON monitoring.sensor, monitoring.reading, monitoring.threshold, monitoring.alert TO eve_api;
CALL meta.grant_columns_except('monitoring.device', 'SELECT', 'eve_api', '{device_key_hash}');

-- eve_monitoring
CALL meta.grant_relations('{monitoring}', 'SELECT, INSERT, UPDATE', 'eve_monitoring');
REVOKE SELECT ON monitoring.device FROM eve_monitoring;
CALL meta.grant_columns_except('monitoring.device', 'SELECT', 'eve_monitoring', '{device_key_hash}');
CALL meta.grant_relations('{core}', 'SELECT', 'eve_monitoring');
GRANT SELECT (id, full_name, role) ON iam.user_account TO eve_monitoring;

-- eve_readonly
CALL meta.grant_relations('{meta,iam,core,agro,inventory,sales,files,site,sync,audit,monitoring}',
  'SELECT', 'eve_readonly', '{r,v}');
REVOKE SELECT ON iam.user_account, iam.refresh_token, monitoring.device FROM eve_readonly;
CALL meta.grant_columns_except('iam.user_account', 'SELECT', 'eve_readonly', '{password_hash}');
CALL meta.grant_columns_except('iam.refresh_token', 'SELECT', 'eve_readonly', '{token_hash}');
CALL meta.grant_columns_except('monitoring.device', 'SELECT', 'eve_readonly', '{device_key_hash}');
GRANT SELECT ON ALL SEQUENCES IN SCHEMA sync, audit TO eve_readonly;

-- fungsi
REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA meta, iam, core, agro, inventory, sales, files, site, sync,
  audit, monitoring FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE eve_owner REVOKE EXECUTE ON ROUTINES FROM PUBLIC;
GRANT EXECUTE ON FUNCTION meta.fail(text, text) TO eve_api, eve_monitoring;
GRANT EXECUTE ON FUNCTION iam.ctx_user_id(), iam.ctx_role(), iam.ctx_farm_id(), iam.ctx_greenhouse_id(),
  iam.can_see_farm_row(uuid), iam.can_see_gh_row(uuid, uuid), iam.can_see_user(uuid),
  iam.can_manage_user(uuid), iam.user_farm_id(uuid) TO eve_api, eve_monitoring, eve_readonly;
GRANT EXECUTE ON FUNCTION iam.is_worker_of_gh(uuid, uuid), iam.auth_lookup(text), iam.auth_scope(uuid),
  iam.auth_set_password(uuid, text), iam.auth_find_refresh(text) TO eve_api;
GRANT EXECUTE ON FUNCTION monitoring.device_auth(text) TO eve_monitoring;
```

Pemeriksaan cepat setelah migrasi (tidak dijalankan):

```text
SET ROLE eve_api;
SELECT password_hash FROM iam.user_account;      -- ERROR: permission denied for table user_account
SELECT count(*) FROM agro.harvest;               -- 0 (konteks kosong)
INSERT INTO monitoring.alert ...;                -- ERROR: permission denied
```
