# 04.02 — Schema `iam` (identitas, cakupan, token, perangkat, konteks RLS)

Migrasi: `0003_iam.sql`. Berisi user, assignment (cakupan peran), refresh token, perangkat mobile,
fungsi konteks RLS (konvensi §6), fungsi visibilitas user, dan fungsi `SECURITY DEFINER` untuk login.
FK `user_assignment → core.farm/core.greenhouse` ditambahkan di `03-core.md` (tabel core belum ada di sini).

## 1. Tabel

`iam.user_account` — MASTER tanpa `archived_at` (nonaktif = `is_active=false`).

| Kolom | Tipe | Aturan |
|---|---|---|
| `username` | `text` | `^[A-Za-z0-9._-]{3,32}$`; unik pada `lower(username)` |
| `full_name` | `text` | 1–120 karakter |
| `phone` | `text` NULL | `^\+?[0-9]{8,15}$` |
| `password_hash` | `text` | argon2id (`^\$argon2id\$`); **tidak bisa dibaca `eve_api`** (hak kolom, `13-grants.md`) |
| `role` | `text` | `ADMIN`/`SUPERVISOR`/`SELLER`/`WORKER`; tidak boleh berubah selama ada assignment aktif |
| `is_active` | `boolean` | default `true` |
| `scope_version` | `integer` | default 1; naik tiap assignment dibuat/dicabut |
| `last_login_at` | `timestamptz` NULL | diisi service saat login |

`iam.user_assignment` — cakupan peran; hanya `revoked_at/revoked_by` yang boleh berubah, sekali.

| Kolom | Tipe | Aturan |
|---|---|---|
| `id` | `uuid` PK | `uuidv7()` |
| `user_id` | `uuid` → user_account | satu aktif per user (partial unique) |
| `farm_id` | `uuid` NULL → core.farm | bentuk sesuai peran (trigger) |
| `greenhouse_id` | `uuid` NULL → core.greenhouse | FK komposit `(greenhouse_id, farm_id)` |
| `assigned_at`, `assigned_by` | `timestamptz`, `uuid` | default `now()`; pembuat |
| `revoked_at`, `revoked_by` | `timestamptz` NULL, `uuid` NULL | keduanya terisi bersama |

`iam.device` — perangkat mobile terdaftar (sumber `KODEPERANGKAT` nota, K-35).

| Kolom | Tipe | Aturan |
|---|---|---|
| `id` | `uuid` PK | dibuat server |
| `user_id` | `uuid` → user_account | pemilik |
| `device_code` | `text` UNIQUE | base32 `^[A-Z2-7]{4,6}$`, dibuat server |
| `platform` | `text` | `ANDROID`/`IOS` |
| `model`, `app_version` | `text` NULL | informasi |
| `registered_at` | `timestamptz` | default `now()` |
| `last_sync_at`, `revoked_at` | `timestamptz` NULL | diisi service |

`iam.refresh_token` — hanya hash disimpan; rotasi per pemakaian.

| Kolom | Tipe | Aturan |
|---|---|---|
| `id` | `uuid` PK | `uuidv7()` |
| `user_id` | `uuid` → user_account | |
| `family_id` | `uuid` | semua token hasil rotasi dari satu login |
| `token_hash` | `text` UNIQUE | sha256 hex; tidak bisa dibaca `eve_api` |
| `device_id` | `uuid` NULL → device | NULL untuk sesi website |
| `issued_at`, `expires_at` | `timestamptz` | `expires_at > issued_at` |
| `used_at`, `revoked_at` | `timestamptz` NULL | |
| `replaced_by` | `uuid` NULL → refresh_token | token pengganti |

## 2. Fungsi

| Fungsi | Jenis | Isi |
|---|---|---|
| `ctx_user_id/ctx_role/ctx_farm_id/ctx_greenhouse_id()` | SQL `STABLE` | konvensi §6 |
| `can_see_farm_row(farm)`, `can_see_gh_row(farm, gh)` | SQL `STABLE` | konvensi §6; hasil selalu `true/false`, tidak pernah `NULL` |
| `user_farm_id(user)` | DEFINER | farm dari assignment aktif, atau assignment terakhir yang dicabut |
| `can_see_user(user)` | DEFINER | ADMIN; diri sendiri; SUPERVISOR bila user di farm-nya (atau user tanpa farm yang ia buat) |
| `can_manage_user(user)` | DEFINER | ADMIN; SUPERVISOR bila target `WORKER/SELLER` dan terlihat seperti di atas |
| `is_worker_of_gh(user, gh)` | DEFINER | user WORKER aktif dengan assignment aktif di gh itu |
| `auth_lookup(username)` | DEFINER | `(id, password_hash, role, is_active, scope_version)` untuk login tanpa konteks |
| `auth_scope(user)` | DEFINER | `(role, is_active, scope_version, farm_id, greenhouse_id)` untuk plugin `authenticate` |
| `auth_set_password(user, hash)` | DEFINER | hanya diri sendiri atau `can_manage_user`; selain itu `FORBIDDEN` |
| `auth_find_refresh(hash)` | DEFINER | baris token tanpa hash, untuk refresh tanpa konteks |

## 3. Invarian

1. Maks satu assignment aktif per user (`user_assignment_one_active`).
2. Bentuk assignment: ADMIN `(NULL,NULL)`; SUPERVISOR/SELLER `(farm,NULL)`; WORKER `(farm,gh)` dengan gh milik farm → `ASSIGNMENT_SHAPE`.
3. Assignment dibuat/dicabut → `user_account.scope_version + 1` (trigger, satu transaksi).
4. Assignment yang sudah dicabut tidak bisa diubah (`ROW_FINAL`); kolom selain `revoked_*` beku.
5. Non-ADMIN yang mengubah dirinya sendiri hanya boleh menyentuh `full_name, phone, last_login_at, password_hash, scope_version` → selain itu `FORBIDDEN`.
6. SUPERVISOR hanya mengelola user ber-peran `WORKER/SELLER` (sebelum dan sesudah UPDATE).
7. Refresh token: hanya `used_at, revoked_at, replaced_by` yang boleh berubah.

## 4. DDL

```sql
-- 0003_iam.sql
-- konteks RLS (konvensi §6)
CREATE FUNCTION iam.ctx_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
CREATE FUNCTION iam.ctx_role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.role', true), '') $$;
CREATE FUNCTION iam.ctx_farm_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.farm_id', true), '')::uuid $$;
CREATE FUNCTION iam.ctx_greenhouse_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.greenhouse_id', true), '')::uuid $$;

CREATE TABLE iam.user_account (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  username text NOT NULL CHECK (username ~ '^[A-Za-z0-9._-]{3,32}$'),
  full_name text NOT NULL CHECK (length(full_name) BETWEEN 1 AND 120),
  phone text CHECK (phone ~ '^\+?[0-9]{8,15}$'),
  password_hash text NOT NULL CHECK (password_hash ~ '^\$argon2id\$'),
  role text NOT NULL CHECK (role IN ('ADMIN', 'SUPERVISOR', 'SELLER', 'WORKER')),
  is_active boolean NOT NULL DEFAULT true,
  scope_version integer NOT NULL DEFAULT 1 CHECK (scope_version > 0),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX user_account_username_uq ON iam.user_account (lower(username));
CREATE INDEX user_account_created_by_idx ON iam.user_account (created_by);

CREATE TABLE iam.user_assignment (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES iam.user_account (id),
  farm_id uuid,
  greenhouse_id uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid REFERENCES iam.user_account (id),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES iam.user_account (id),
  CHECK (greenhouse_id IS NULL OR farm_id IS NOT NULL),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE UNIQUE INDEX user_assignment_one_active ON iam.user_assignment (user_id) WHERE revoked_at IS NULL;
CREATE INDEX user_assignment_farm_idx ON iam.user_assignment (farm_id);
CREATE INDEX user_assignment_gh_idx ON iam.user_assignment (greenhouse_id, farm_id);
CREATE INDEX user_assignment_assigned_by_idx ON iam.user_assignment (assigned_by);
CREATE INDEX user_assignment_revoked_by_idx ON iam.user_assignment (revoked_by);

CREATE TABLE iam.device (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES iam.user_account (id),
  device_code text NOT NULL UNIQUE CHECK (device_code ~ '^[A-Z2-7]{4,6}$'),
  platform text NOT NULL CHECK (platform IN ('ANDROID', 'IOS')),
  model text,
  app_version text,
  registered_at timestamptz NOT NULL DEFAULT now(),
  last_sync_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX device_user_idx ON iam.device (user_id);

CREATE TABLE iam.refresh_token (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES iam.user_account (id),
  family_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  device_id uuid REFERENCES iam.device (id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  replaced_by uuid REFERENCES iam.refresh_token (id),
  CHECK (expires_at > issued_at)
);
CREATE INDEX refresh_token_user_idx ON iam.refresh_token (user_id);
CREATE INDEX refresh_token_family_idx ON iam.refresh_token (family_id);
CREATE INDEX refresh_token_device_idx ON iam.refresh_token (device_id);
CREATE INDEX refresh_token_replaced_by_idx ON iam.refresh_token (replaced_by);

CREATE FUNCTION iam.can_see_farm_row(p_farm_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(CASE
    WHEN iam.ctx_role() = 'ADMIN' THEN true
    WHEN iam.ctx_role() IN ('SUPERVISOR', 'SELLER', 'WORKER') THEN p_farm_id = iam.ctx_farm_id()
    ELSE false END, false) $$;

CREATE FUNCTION iam.can_see_gh_row(p_farm_id uuid, p_greenhouse_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(CASE
    WHEN iam.ctx_role() = 'ADMIN' THEN true
    WHEN iam.ctx_role() IN ('SUPERVISOR', 'SELLER') THEN p_farm_id = iam.ctx_farm_id()
    WHEN iam.ctx_role() = 'WORKER' THEN p_farm_id = iam.ctx_farm_id()
      AND p_greenhouse_id = iam.ctx_greenhouse_id()
    ELSE false END, false) $$;

-- visibilitas user (DEFINER: membaca iam tanpa RLS, mencegah rekursi policy)
CREATE FUNCTION iam.user_farm_id(p_user_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT a.farm_id FROM iam.user_assignment a WHERE a.user_id = p_user_id
  ORDER BY (a.revoked_at IS NULL) DESC, a.assigned_at DESC LIMIT 1 $$;

CREATE FUNCTION iam.can_see_user(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(
    iam.ctx_role() = 'ADMIN'
    OR p_user_id = iam.ctx_user_id()
    OR (iam.ctx_role() = 'SUPERVISOR' AND (
      iam.user_farm_id(p_user_id) = iam.ctx_farm_id()
      OR (iam.user_farm_id(p_user_id) IS NULL AND EXISTS (
        SELECT 1 FROM iam.user_account u
        WHERE u.id = p_user_id AND u.created_by = iam.ctx_user_id())))), false) $$;

CREATE FUNCTION iam.can_manage_user(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(
    iam.ctx_role() = 'ADMIN'
    OR (iam.ctx_role() = 'SUPERVISOR' AND p_user_id <> iam.ctx_user_id()
      AND iam.can_see_user(p_user_id)
      AND EXISTS (SELECT 1 FROM iam.user_account u
        WHERE u.id = p_user_id AND u.role IN ('WORKER', 'SELLER'))), false) $$;

CREATE FUNCTION iam.is_worker_of_gh(p_user_id uuid, p_greenhouse_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM iam.user_account u
    JOIN iam.user_assignment a ON a.user_id = u.id AND a.revoked_at IS NULL
    WHERE u.id = p_user_id AND u.role = 'WORKER' AND u.is_active
      AND a.greenhouse_id = p_greenhouse_id) $$;

-- aturan user_account & assignment
CREATE FUNCTION iam.user_account_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_self_cols text[] := ARRAY['full_name', 'phone', 'last_login_at', 'password_hash',
    'scope_version', 'updated_at', 'version'];
BEGIN
  IF NEW.role <> OLD.role AND EXISTS (SELECT 1 FROM iam.user_assignment a
      WHERE a.user_id = OLD.id AND a.revoked_at IS NULL) THEN
    PERFORM meta.fail('ROLE_HAS_ASSIGNMENT');
  END IF;
  IF iam.ctx_role() IS NULL OR iam.ctx_role() = 'ADMIN' THEN
    RETURN NEW;
  END IF;
  IF OLD.id = iam.ctx_user_id() THEN
    IF (to_jsonb(NEW) - v_self_cols) <> (to_jsonb(OLD) - v_self_cols) THEN
      PERFORM meta.fail('FORBIDDEN', 'self-update column');
    END IF;
  ELSIF iam.ctx_role() <> 'SUPERVISOR' OR OLD.role NOT IN ('WORKER', 'SELLER')
        OR NEW.role NOT IN ('WORKER', 'SELLER') THEN
    PERFORM meta.fail('FORBIDDEN', 'manage user');
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION iam.assignment_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_role text;
  v_ok boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.revoked_at IS NOT NULL THEN
    PERFORM meta.fail('ROW_FINAL', 'user_assignment');
  END IF;
  SELECT u.role INTO v_role FROM iam.user_account u WHERE u.id = NEW.user_id;
  v_ok := CASE v_role
    WHEN 'ADMIN' THEN NEW.farm_id IS NULL AND NEW.greenhouse_id IS NULL
    WHEN 'WORKER' THEN NEW.farm_id IS NOT NULL AND NEW.greenhouse_id IS NOT NULL
    ELSE NEW.farm_id IS NOT NULL AND NEW.greenhouse_id IS NULL END;
  IF NOT v_ok THEN
    PERFORM meta.fail('ASSIGNMENT_SHAPE', v_role);
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION iam.bump_scope_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  UPDATE iam.user_account SET scope_version = scope_version + 1 WHERE id = NEW.user_id;
  RETURN NULL;
END $$;

CALL meta.install_kind('iam.user_account', 'MASTER');
CREATE TRIGGER tg_40_guard BEFORE UPDATE ON iam.user_account
  FOR EACH ROW EXECUTE FUNCTION iam.user_account_guard();
CREATE TRIGGER tg_10_no_delete BEFORE DELETE ON iam.user_assignment
  FOR EACH ROW EXECUTE FUNCTION meta.forbid_delete();
CREATE TRIGGER tg_31_freeze BEFORE UPDATE ON iam.user_assignment FOR EACH ROW
  EXECUTE FUNCTION meta.freeze_columns('user_id', 'farm_id', 'greenhouse_id', 'assigned_at', 'assigned_by');
CREATE TRIGGER tg_40_check BEFORE INSERT OR UPDATE ON iam.user_assignment
  FOR EACH ROW EXECUTE FUNCTION iam.assignment_check();
CREATE TRIGGER tg_60_scope_version AFTER INSERT OR UPDATE OF revoked_at ON iam.user_assignment
  FOR EACH ROW EXECUTE FUNCTION iam.bump_scope_version();
CREATE TRIGGER tg_10_no_delete BEFORE DELETE ON iam.device
  FOR EACH ROW EXECUTE FUNCTION meta.forbid_delete();
CREATE TRIGGER tg_31_freeze BEFORE UPDATE ON iam.device FOR EACH ROW
  EXECUTE FUNCTION meta.freeze_columns('user_id', 'device_code', 'registered_at');
CREATE TRIGGER tg_10_no_delete BEFORE DELETE ON iam.refresh_token
  FOR EACH ROW EXECUTE FUNCTION meta.forbid_delete();
CREATE TRIGGER tg_31_freeze BEFORE UPDATE ON iam.refresh_token FOR EACH ROW
  EXECUTE FUNCTION meta.freeze_columns('user_id', 'family_id', 'token_hash', 'device_id',
    'issued_at', 'expires_at');

-- fungsi login (tanpa konteks RLS)
CREATE FUNCTION iam.auth_lookup(p_username text)
RETURNS TABLE (id uuid, password_hash text, role text, is_active boolean, scope_version integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT u.id, u.password_hash, u.role, u.is_active, u.scope_version
  FROM iam.user_account u WHERE lower(u.username) = lower(p_username) $$;

CREATE FUNCTION iam.auth_scope(p_user_id uuid)
RETURNS TABLE (role text, is_active boolean, scope_version integer, farm_id uuid, greenhouse_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT u.role, u.is_active, u.scope_version, a.farm_id, a.greenhouse_id
  FROM iam.user_account u
  LEFT JOIN iam.user_assignment a ON a.user_id = u.id AND a.revoked_at IS NULL
  WHERE u.id = p_user_id $$;

CREATE FUNCTION iam.auth_set_password(p_user_id uuid, p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT coalesce(p_user_id = iam.ctx_user_id() OR iam.can_manage_user(p_user_id), false) THEN
    PERFORM meta.fail('FORBIDDEN', 'set password');
  END IF;
  UPDATE iam.user_account SET password_hash = p_hash WHERE id = p_user_id;
  IF NOT FOUND THEN
    PERFORM meta.fail('NOT_FOUND', 'user');
  END IF;
END $$;

CREATE FUNCTION iam.auth_find_refresh(p_hash text)
RETURNS TABLE (id uuid, user_id uuid, family_id uuid, device_id uuid,
  expires_at timestamptz, used_at timestamptz, revoked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT t.id, t.user_id, t.family_id, t.device_id, t.expires_at, t.used_at, t.revoked_at
  FROM iam.refresh_token t WHERE t.token_hash = p_hash $$;

CALL meta.index_foreign_keys('iam');
```

Alur yang dipakai App Pusat (tidak dijalankan):

```text
login   : SELECT * FROM iam.auth_lookup($username)  → verifikasi argon2 di Node
          → set_config('app.user_id', id), set_config('app.role', role) → INSERT refresh_token (milik sendiri)
refresh : SELECT * FROM iam.auth_find_refresh($sha256) → set konteks user itu → rotasi (UPDATE used_at, INSERT baru)
request : SELECT * FROM iam.auth_scope($sub) → bandingkan scope_version token → set_config 4 kunci
```
