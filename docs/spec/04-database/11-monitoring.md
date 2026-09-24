# 04.11 — Schema `monitoring` (perangkat sensor, pembacaan, ambang, alert)

Migrasi: `0012_monitoring.sql`. Pemilik logika: aplikasi Monitoring (role `eve_monitoring`, K-13).
Schema ini hanya **membaca** struktur `core`; tidak ada FK/trigger dari schema bisnis ke sini.
Perangkat ESP32 mengirim `X-Device-Key`; Monitoring memanggil `monitoring.device_auth(sha256(key))`
lalu menyetel konteks `app.role='DEVICE'`, `app.farm_id`, `app.greenhouse_id` perangkat itu.
Tidak ada sinkronisasi ke mobile (tanpa `tg_sync`). Kolom standar: `01-schemas-meta.md` §2.

## 1. Tabel

`monitoring.device` — MASTER.

| Kolom | Tipe | Aturan |
|---|---|---|
| `farm_id`, `greenhouse_id` | `uuid` | farm dari greenhouse; beku |
| `code` | `text` | `^[A-Z0-9-]{1,16}$`, unik per greenhouse |
| `name` | `text` | wajib |
| `device_key_hash` | `text` UNIQUE | sha256 hex dari kunci perangkat; tidak bisa dibaca `eve_monitoring` |
| `firmware` | `text` NULL | dilaporkan perangkat |
| `is_active` | `boolean` | default `true` |
| `last_seen_at` | `timestamptz` NULL | heartbeat; perubahan ini tidak menaikkan `version` & tidak diaudit |

`monitoring.sensor` — MASTER: `device_id`, `farm_id`, `greenhouse_id` (dari perangkat), `reservoir_id`/`block_id`/
`grow_table_id` NULL (harus di greenhouse yang sama — FK komposit), `sensor_type`
(`PH/EC/WATER_TEMP/AIR_TEMP/HUMIDITY/LIGHT/WATER_LEVEL/FLOW/DISSOLVED_OXYGEN`), `code` unik per perangkat,
`unit` (1..16), `calibration_offset numeric(10,3)` default 0, `is_active`.

`monitoring.reading` — FACT tanpa `id`/`created_by`.

| Kolom | Tipe | Aturan |
|---|---|---|
| `sensor_id`, `measured_at` | `uuid`, `timestamptz` | **PK** — kiriman ulang perangkat tidak menggandakan (`ON CONFLICT DO NOTHING`) |
| `value` | `numeric(10,3)` | nilai terkalibrasi: trigger menambahkan `sensor.calibration_offset` ke nilai mentah |
| `received_at` | `timestamptz` | default `now()` |
| `farm_id`, `greenhouse_id` | `uuid` | disalin dari sensor; sengaja tanpa FK (jalur ingest volume tinggi, konsistensi dijamin trigger) |

`monitoring.threshold` — MASTER: `farm_id`, `greenhouse_id`, `sensor_type`, `warn_min`, `warn_max`, `crit_min`,
`crit_max` (`numeric(10,3)` NULL); `UNIQUE (greenhouse_id, sensor_type)`; `crit_min ≤ warn_min < warn_max ≤ crit_max`
untuk pasangan yang terisi; minimal satu batas terisi.

`monitoring.alert` — STATEFUL.

| Kolom | Tipe | Aturan |
|---|---|---|
| `farm_id`, `greenhouse_id`, `sensor_type` | | disalin dari sensor |
| `sensor_id` | `uuid` → sensor | maks satu alert belum `RESOLVED` per sensor |
| `level` | `text` | `WARNING`/`CRITICAL` (boleh naik/turun selama terbuka) |
| `status` | `text` | `OPEN` → `ACKNOWLEDGED` → `RESOLVED` (atau `OPEN` → `RESOLVED`) |
| `opened_at`, `last_value`, `last_seen_at` | | nilai terakhir; perubahan tidak menaikkan `version` |
| `acknowledged_by`, `acknowledged_at` | NULL | terisi ⇔ pernah di-acknowledge |
| `resolved_at` | NULL | terisi ⇔ `RESOLVED` |

## 2. Invarian

1. `device_auth` hanya mengembalikan perangkat aktif & tidak diarsip; tanpa konteks RLS (`SECURITY DEFINER`).
2. Konteks `DEVICE` hanya boleh mengubah `last_seen_at`, `firmware` pada `device` → selain itu `FORBIDDEN`.
3. Alert: manusia (ADMIN/SUPERVISOR/WORKER) hanya meng-acknowledge (`status → ACKNOWLEDGED`, `acknowledged_*`);
   `DEVICE` (ingest) hanya mengubah `level`, `last_value`, `last_seen_at`, `status → RESOLVED`, `resolved_at`.
4. Pembacaan untuk sensor nonaktif ditolak (`SENSOR_INACTIVE`).
5. Tidak ada retensi/penghapusan pembacaan otomatis (di luar cakupan; `reading` append-only).

## 3. DDL

```sql
-- 0012_monitoring.sql
CREATE TABLE monitoring.device (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  greenhouse_id uuid NOT NULL REFERENCES core.greenhouse (id),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9-]{1,16}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  device_key_hash text NOT NULL UNIQUE CHECK (device_key_hash ~ '^[0-9a-f]{64}$'),
  firmware text,
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  UNIQUE (greenhouse_id, code)
);

CREATE TABLE monitoring.sensor (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  device_id uuid NOT NULL REFERENCES monitoring.device (id),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  greenhouse_id uuid NOT NULL REFERENCES core.greenhouse (id),
  reservoir_id uuid,
  block_id uuid,
  grow_table_id uuid,
  sensor_type text NOT NULL CHECK (sensor_type IN ('PH', 'EC', 'WATER_TEMP', 'AIR_TEMP', 'HUMIDITY',
    'LIGHT', 'WATER_LEVEL', 'FLOW', 'DISSOLVED_OXYGEN')),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9-]{1,16}$'),
  unit text NOT NULL CHECK (length(unit) BETWEEN 1 AND 16),
  calibration_offset numeric(10,3) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  FOREIGN KEY (reservoir_id, greenhouse_id) REFERENCES core.reservoir (id, greenhouse_id),
  FOREIGN KEY (block_id, greenhouse_id) REFERENCES core.block (id, greenhouse_id),
  FOREIGN KEY (grow_table_id, greenhouse_id) REFERENCES core.grow_table (id, greenhouse_id),
  UNIQUE (device_id, code)
);

CREATE TABLE monitoring.reading (
  sensor_id uuid NOT NULL REFERENCES monitoring.sensor (id),
  measured_at timestamptz NOT NULL,
  value numeric(10,3) NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  farm_id uuid NOT NULL,
  greenhouse_id uuid NOT NULL,
  PRIMARY KEY (sensor_id, measured_at)
);
CREATE INDEX reading_measured_brin ON monitoring.reading USING brin (measured_at);
CREATE INDEX reading_gh_time_idx ON monitoring.reading (greenhouse_id, measured_at);

CREATE TABLE monitoring.threshold (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  greenhouse_id uuid NOT NULL REFERENCES core.greenhouse (id),
  sensor_type text NOT NULL CHECK (sensor_type IN ('PH', 'EC', 'WATER_TEMP', 'AIR_TEMP', 'HUMIDITY',
    'LIGHT', 'WATER_LEVEL', 'FLOW', 'DISSOLVED_OXYGEN')),
  warn_min numeric(10,3),
  warn_max numeric(10,3),
  crit_min numeric(10,3),
  crit_max numeric(10,3),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  UNIQUE (greenhouse_id, sensor_type),
  CHECK (num_nonnulls(warn_min, warn_max, crit_min, crit_max) >= 1),
  -- pasangan yang NULL bernilai NULL (lolos); satu pasangan terisi yang salah membuat AND = false
  CHECK (crit_min <= warn_min AND warn_min < warn_max AND warn_max <= crit_max
    AND crit_min < crit_max AND crit_min < warn_max AND warn_min < crit_max)
);

CREATE TABLE monitoring.alert (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  greenhouse_id uuid NOT NULL REFERENCES core.greenhouse (id),
  sensor_id uuid NOT NULL REFERENCES monitoring.sensor (id),
  sensor_type text NOT NULL,
  level text NOT NULL CHECK (level IN ('WARNING', 'CRITICAL')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  last_value numeric(10,3) NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_by uuid REFERENCES iam.user_account (id),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CHECK ((acknowledged_at IS NULL) = (acknowledged_by IS NULL)),
  CHECK (status <> 'ACKNOWLEDGED' OR acknowledged_at IS NOT NULL),
  CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL))
);
CREATE UNIQUE INDEX alert_one_open_per_sensor ON monitoring.alert (sensor_id) WHERE status <> 'RESOLVED';
CREATE INDEX alert_gh_status_idx ON monitoring.alert (greenhouse_id, status);

CREATE FUNCTION monitoring.device_auth(p_key_hash text)
RETURNS TABLE (device_id uuid, farm_id uuid, greenhouse_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT d.id, d.farm_id, d.greenhouse_id FROM monitoring.device d
  WHERE d.device_key_hash = p_key_hash AND d.is_active AND d.archived_at IS NULL $$;

CREATE FUNCTION monitoring.limit_columns() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_human text[] := ARRAY['status', 'acknowledged_by', 'acknowledged_at', 'version', 'updated_at'];
  v_device text[] := ARRAY['level', 'last_value', 'last_seen_at', 'status', 'resolved_at',
    'version', 'updated_at'];
  v_allowed text[];
BEGIN
  IF TG_TABLE_NAME = 'device' THEN
    v_allowed := CASE WHEN iam.ctx_role() = 'DEVICE'
      THEN ARRAY['last_seen_at', 'firmware', 'version', 'updated_at'] END;
  ELSIF iam.ctx_role() = 'DEVICE' THEN
    v_allowed := v_device;
    IF NEW.status NOT IN (OLD.status, 'RESOLVED') THEN
      PERFORM meta.fail('FORBIDDEN', 'device alert status');
    END IF;
  ELSIF iam.ctx_role() IN ('ADMIN', 'SUPERVISOR', 'WORKER') THEN
    v_allowed := v_human;
    IF NEW.status NOT IN (OLD.status, 'ACKNOWLEDGED') THEN
      PERFORM meta.fail('FORBIDDEN', 'alert status');
    END IF;
  END IF;
  IF v_allowed IS NOT NULL AND (to_jsonb(NEW) - v_allowed) <> (to_jsonb(OLD) - v_allowed) THEN
    PERFORM meta.fail('FORBIDDEN', TG_TABLE_NAME || ' columns');
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION monitoring.reading_fill() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  s monitoring.sensor%ROWTYPE;
BEGIN
  SELECT * INTO s FROM monitoring.sensor WHERE id = NEW.sensor_id;
  IF NOT FOUND THEN
    PERFORM meta.fail('PARENT_NOT_FOUND', 'reading.sensor_id');
  ELSIF NOT s.is_active OR s.archived_at IS NOT NULL THEN
    PERFORM meta.fail('SENSOR_INACTIVE');
  END IF;
  NEW.farm_id := s.farm_id;
  NEW.greenhouse_id := s.greenhouse_id;
  NEW.value := NEW.value + s.calibration_offset;
  RETURN NEW;
END $$;

CALL meta.install_kind('monitoring.device', 'MASTER', '{last_seen_at,firmware}');
CALL meta.install_kind('monitoring.sensor', 'MASTER');
CALL meta.install_kind('monitoring.reading', 'FACT');
CALL meta.install_kind('monitoring.threshold', 'MASTER');
CALL meta.install_kind('monitoring.alert', 'STATEFUL', '{last_value,last_seen_at}');
CALL meta.install_scope('monitoring.device', 'core.greenhouse|greenhouse_id|farm_id');
CALL meta.install_scope('monitoring.sensor',
  'monitoring.device|device_id|farm_id,greenhouse_id');
CALL meta.install_scope('monitoring.threshold', 'core.greenhouse|greenhouse_id|farm_id');
CALL meta.install_scope('monitoring.alert', 'monitoring.sensor|sensor_id|farm_id,greenhouse_id,sensor_type');
CALL meta.install_transitions('monitoring.alert', '{OPEN}', 'OPEN>ACKNOWLEDGED', 'OPEN>RESOLVED',
  'ACKNOWLEDGED>RESOLVED');
CREATE TRIGGER tg_30_fill_scope BEFORE INSERT ON monitoring.reading
  FOR EACH ROW EXECUTE FUNCTION monitoring.reading_fill();
CREATE TRIGGER tg_40_limit BEFORE UPDATE ON monitoring.device
  FOR EACH ROW EXECUTE FUNCTION monitoring.limit_columns();
CREATE TRIGGER tg_40_limit BEFORE UPDATE ON monitoring.alert
  FOR EACH ROW EXECUTE FUNCTION monitoring.limit_columns();

CREATE TRIGGER tg_audit AFTER INSERT OR UPDATE OF farm_id, greenhouse_id, code, name,
  device_key_hash, is_active, archived_at ON monitoring.device
  FOR EACH ROW EXECUTE FUNCTION audit.capture();
CALL audit.install_capture('monitoring.sensor');
CALL audit.install_capture('monitoring.threshold');
CALL meta.index_foreign_keys('monitoring');
```
