# 04.01 — Schema & Fungsi Generik `meta`

Migrasi: `0001_schemas.sql` (bagian A) dan `0002_meta_functions.sql` (bagian B).
Membuat 11 schema (konvensi §1), menutup schema `public`, tabel `meta.schema_migration`,
dan semua fungsi/prosedur generik yang dipakai file `02`–`13`.

## 1. Tabel

`meta.schema_migration` — diisi oleh runner migrasi, bukan oleh aplikasi.

| Kolom | Tipe | Aturan |
|---|---|---|
| `version` | `text` PK | `NNNN`, 4 digit |
| `name` | `text` | nama file tanpa `.sql` |
| `checksum` | `text` | sha256 hex isi file; berubah → runner gagal |
| `applied_at` | `timestamptz` | default `now()` |

## 2. Kolom standar per kelompok (dipakai semua dokumen berikutnya)

Tabel kolom di file `02`–`11` hanya mencantumkan kolom **non-standar**. Kolom standar:

| Kelompok | Kolom standar (selalu ada, urutan ini) |
|---|---|
| MASTER | `id uuid PK DEFAULT uuidv7()`, `created_at`, `created_by → iam.user_account`, `updated_at`, `version int DEFAULT 1`, `archived_at` |
| STATEFUL | `id`, `created_at`, `created_by`, `updated_at`, `version` |
| FACT | `id`, `created_at`, `created_by`, `device_id → iam.device` (nullable) |

`created_by` selalu `DEFAULT iam.ctx_user_id()`: terisi otomatis dari konteks request, NULL hanya untuk
seed/`eve_owner` tanpa konteks. Aturan yang bergantung pada pembuat (mis. void oleh worker) memakai kolom ini.

## 3. Fungsi & prosedur

| Nama | Jenis | Efek |
|---|---|---|
| `meta.fail(code, detail)` | fungsi | `RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE=code` — satu-satunya cara melempar error bisnis |
| `meta.touch_row(ignore...)` | trigger | `updated_at=now()`, `version=OLD.version+1`; bila hanya kolom `ignore` yang berubah → tidak menyentuh (heartbeat) |
| `meta.check_version()` | trigger | `NEW.version <> OLD.version` → `VERSION_CONFLICT` |
| `meta.forbid_update_delete()` | trigger | → `APPEND_ONLY` |
| `meta.forbid_delete()` | trigger | → `NO_DELETE` |
| `meta.check_transition('A>B'...)` | trigger | status sumber tidak terdaftar → `ROW_FINAL`; pasangan tidak terdaftar → `INVALID_TRANSITION` |
| `meta.fill_scope('induk\|fk\|kol,kol'...)` | trigger | isi kolom scope dari induk; nilai klien beda → `SCOPE_MISMATCH`; induk tak terlihat → `PARENT_NOT_FOUND` |
| `meta.freeze_columns(kol...)` | trigger | kolom berubah saat UPDATE → `IMMUTABLE_COLUMN` |
| `meta.install_kind(tbl, kind, ignore)` | prosedur | pasang trigger kelompok MASTER/STATEFUL/FACT |
| `meta.install_scope(tbl, spec...)` | prosedur | pasang `fill_scope` (INSERT) + `freeze_columns` (UPDATE) |
| `meta.check_initial_status(S...)` | trigger | status saat INSERT di luar daftar → `INVALID_STATUS` |
| `meta.install_transitions(tbl, awal[], 'A>B'...)` | prosedur | pasang `check_initial_status` + `check_transition` |
| `meta.index_foreign_keys(schema)` | prosedur | buat index untuk setiap FK di schema yang belum ber-index (konvensi §2); dipanggil di akhir tiap migrasi |

Urutan trigger BEFORE ditentukan nama (Postgres menjalankan urut abjad):
`tg_10_*` (append-only / no-delete) → `tg_20_check_version` → `tg_30_fill_scope` → `tg_31_freeze_scope`
→ `tg_40_*` (aturan khusus tabel) → `tg_41_initial_status` → `tg_50_transition` → `tg_90_touch`.
Trigger AFTER: `tg_60_*` (aturan khusus), `tg_sync` (`09`), `tg_audit` (`10`); constraint trigger tertunda `tg_c*`.

`meta.touch_row` memberi versi baru; `check_version` berjalan lebih dulu sehingga klien mengirim
versi yang ia pegang (`UPDATE ... SET status=..., version=$expected`). UPDATE yang tidak menyebut
`version` (mis. trigger internal) selalu lolos cek dan tetap menaikkan versi.

## 4. Invarian

1. Schema `public` tidak dipakai; `PUBLIC` tidak punya hak apa pun di dalamnya.
2. Semua error bisnis dari database memakai SQLSTATE `P0001` dan `MESSAGE` berupa kode stabil `UPPER_SNAKE`.
3. `fill_scope` berjalan sebagai pemanggil: induk yang tidak lolos RLS pemanggil dianggap tidak ada.
4. `TRUNCATE` tidak dicegah trigger (hanya `eve_owner` yang punya hak, dan hanya test runner yang memakainya).

## 5. DDL

```sql
-- 0001_schemas.sql
CREATE SCHEMA IF NOT EXISTS meta;
CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS agro;
CREATE SCHEMA IF NOT EXISTS inventory;
CREATE SCHEMA IF NOT EXISTS sales;
CREATE SCHEMA IF NOT EXISTS files;
CREATE SCHEMA IF NOT EXISTS site;
CREATE SCHEMA IF NOT EXISTS sync;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS monitoring;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

CREATE TABLE IF NOT EXISTS meta.schema_migration (
  version text PRIMARY KEY CHECK (version ~ '^[0-9]{4}$'),
  name text NOT NULL,
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT now()
);
```

```sql
-- 0002_meta_functions.sql
CREATE FUNCTION meta.fail(p_code text, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = p_code, DETAIL = coalesce(p_detail, '');
END $$;

CREATE FUNCTION meta.touch_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_NARGS > 0 AND (to_jsonb(NEW) - TG_ARGV) = (to_jsonb(OLD) - TG_ARGV) THEN
    RETURN NEW;
  END IF;
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END $$;

CREATE FUNCTION meta.check_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.version <> OLD.version THEN
    PERFORM meta.fail('VERSION_CONFLICT', TG_TABLE_NAME || ' v' || OLD.version);
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION meta.forbid_update_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM meta.fail('APPEND_ONLY', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME);
  RETURN NULL;
END $$;

CREATE FUNCTION meta.forbid_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM meta.fail('NO_DELETE', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME);
  RETURN NULL;
END $$;

CREATE FUNCTION meta.check_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_sources text[] := ARRAY(SELECT split_part(a, '>', 1) FROM unnest(TG_ARGV) a);
BEGIN
  IF NOT (OLD.status = ANY (v_sources)) THEN
    PERFORM meta.fail('ROW_FINAL', TG_TABLE_NAME || ':' || OLD.status);
  END IF;
  IF NEW.status <> OLD.status
     AND NOT ((OLD.status || '>' || NEW.status) = ANY (TG_ARGV)) THEN
    PERFORM meta.fail('INVALID_TRANSITION', OLD.status || '>' || NEW.status);
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION meta.fill_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_par jsonb;
  v_spec text;
  v_fk text;
  v_col text;
BEGIN
  FOREACH v_spec IN ARRAY TG_ARGV LOOP
    v_fk := split_part(v_spec, '|', 2);
    CONTINUE WHEN v_new ->> v_fk IS NULL;
    EXECUTE format('SELECT to_jsonb(p) FROM %s p WHERE p.id = $1', split_part(v_spec, '|', 1))
      INTO v_par USING (v_new ->> v_fk)::uuid;
    IF v_par IS NULL THEN
      PERFORM meta.fail('PARENT_NOT_FOUND', TG_TABLE_NAME || '.' || v_fk);
    END IF;
    FOREACH v_col IN ARRAY string_to_array(split_part(v_spec, '|', 3), ',') LOOP
      IF (v_new -> v_col) <> 'null'::jsonb AND (v_new -> v_col) <> (v_par -> v_col) THEN
        PERFORM meta.fail('SCOPE_MISMATCH', TG_TABLE_NAME || '.' || v_col);
      END IF;
      v_new := jsonb_set(v_new, ARRAY[v_col], coalesce(v_par -> v_col, 'null'::jsonb));
    END LOOP;
  END LOOP;
  NEW := jsonb_populate_record(NEW, v_new);
  RETURN NEW;
END $$;

CREATE FUNCTION meta.freeze_columns() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_old jsonb := to_jsonb(OLD);
  v_new jsonb := to_jsonb(NEW);
  v_col text;
BEGIN
  FOREACH v_col IN ARRAY TG_ARGV LOOP
    IF (v_old -> v_col) IS DISTINCT FROM (v_new -> v_col) THEN
      PERFORM meta.fail('IMMUTABLE_COLUMN', TG_TABLE_NAME || '.' || v_col);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE FUNCTION meta.quote_args(p_args text[]) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(string_agg(quote_literal(a), ', '), '') FROM unnest(p_args) a
$$;

CREATE PROCEDURE meta.install_kind(p_tbl regclass, p_kind text, p_ignore text[] DEFAULT '{}')
LANGUAGE plpgsql AS $$
BEGIN
  IF p_kind NOT IN ('MASTER', 'STATEFUL', 'FACT') THEN
    PERFORM meta.fail('BAD_KIND', p_kind);
  END IF;
  IF p_kind = 'FACT' THEN
    EXECUTE format('CREATE TRIGGER tg_10_append_only BEFORE UPDATE OR DELETE ON %s '
      'FOR EACH ROW EXECUTE FUNCTION meta.forbid_update_delete()', p_tbl);
    RETURN;
  END IF;
  EXECUTE format('CREATE TRIGGER tg_10_no_delete BEFORE DELETE ON %s '
    'FOR EACH ROW EXECUTE FUNCTION meta.forbid_delete()', p_tbl);
  IF p_kind = 'STATEFUL' THEN
    EXECUTE format('CREATE TRIGGER tg_20_check_version BEFORE UPDATE ON %s '
      'FOR EACH ROW EXECUTE FUNCTION meta.check_version()', p_tbl);
  END IF;
  EXECUTE format('CREATE TRIGGER tg_90_touch BEFORE UPDATE ON %s '
    'FOR EACH ROW EXECUTE FUNCTION meta.touch_row(%s)', p_tbl, meta.quote_args(p_ignore));
END $$;

CREATE PROCEDURE meta.install_scope(p_tbl regclass, VARIADIC p_specs text[])
LANGUAGE plpgsql AS $$
DECLARE
  v_cols text[] := ARRAY(
    SELECT DISTINCT c FROM unnest(p_specs) s,
      unnest(split_part(s, '|', 2) || string_to_array(split_part(s, '|', 3), ',')) c);
BEGIN
  EXECUTE format('CREATE TRIGGER tg_30_fill_scope BEFORE INSERT ON %s '
    'FOR EACH ROW EXECUTE FUNCTION meta.fill_scope(%s)', p_tbl, meta.quote_args(p_specs));
  EXECUTE format('CREATE TRIGGER tg_31_freeze_scope BEFORE UPDATE ON %s '
    'FOR EACH ROW EXECUTE FUNCTION meta.freeze_columns(%s)', p_tbl, meta.quote_args(v_cols));
END $$;

CREATE FUNCTION meta.check_initial_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (NEW.status = ANY (TG_ARGV)) THEN
    PERFORM meta.fail('INVALID_STATUS', TG_TABLE_NAME || ':' || NEW.status);
  END IF;
  RETURN NEW;
END $$;

CREATE PROCEDURE meta.install_transitions(p_tbl regclass, p_initial text[],
  VARIADIC p_pairs text[])
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE TRIGGER tg_41_initial_status BEFORE INSERT ON %s '
    'FOR EACH ROW EXECUTE FUNCTION meta.check_initial_status(%s)', p_tbl, meta.quote_args(p_initial));
  EXECUTE format('CREATE TRIGGER tg_50_transition BEFORE UPDATE ON %s '
    'FOR EACH ROW EXECUTE FUNCTION meta.check_transition(%s)', p_tbl, meta.quote_args(p_pairs));
END $$;

CREATE PROCEDURE meta.index_foreign_keys(p_schema text)
LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass AS tbl,
      (SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.o)
         FROM unnest(c.conkey) WITH ORDINALITY k(n, o)
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n) AS cols
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.contype = 'f' AND t.relnamespace = p_schema::regnamespace
      AND NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = c.conrelid AND i.indpred IS NULL
          AND (SELECT array_agg(x ORDER BY o) FROM unnest(i.indkey::int2[]) WITH ORDINALITY u(x, o)
               WHERE o <= cardinality(c.conkey)) = c.conkey)
  LOOP
    EXECUTE format('CREATE INDEX ON %s (%s)', r.tbl, r.cols);
  END LOOP;
END $$;
```

Contoh pemakaian (tidak dijalankan):

```text
CALL meta.install_kind('core.grow_table', 'MASTER');
CALL meta.install_scope('core.grow_table', 'core.block|block_id|farm_id,greenhouse_id');
-- INSERT grow_table(block_id=B) → farm_id, greenhouse_id diisi dari core.block B.
-- UPDATE grow_table SET block_id = ... → IMMUTABLE_COLUMN.
CALL meta.install_transitions('agro.task', '{OPEN}', 'OPEN>IN_PROGRESS', 'IN_PROGRESS>DONE');
CALL meta.index_foreign_keys('core');  -- index untuk setiap FK yang belum ber-index
```
