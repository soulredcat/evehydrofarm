# 04.05 — Schema `agro`: Operasi Budidaya

Migrasi: `0006_agro_operations.sql`. Siklus tanam per meja, catatan lapangan (kegiatan, input/pestisida,
cek air), tugas, laporan masalah, dan panen. Kolom standar per kelompok: `01-schemas-meta.md` §2.
Kolom scope (`farm_id`, `greenhouse_id`, `block_id`, `grow_table_id`) selalu diisi trigger dari induk.
FK `harvest.product_id → inventory.product` ditambahkan di `06-inventory.md` (produk belum ada di sini).

## 1. Tabel

`agro.planting_cycle` — STATEFUL, `id` dari klien.

| Kolom | Tipe | Aturan |
|---|---|---|
| `farm_id`, `greenhouse_id`, `block_id` | `uuid` | dari meja |
| `grow_table_id` | `uuid` → grow_table | satu siklus `ACTIVE` per meja (R-06) |
| `variety_id` | `uuid` → variety | |
| `commodity_id` | `uuid` | denormalisasi dari varietas |
| `code` | `text` | `^[A-Z0-9-]{3,24}$`, unik per farm |
| `seeded_on`, `transplanted_on` | `date`, `date` NULL | `transplanted_on >= seeded_on` |
| `planted_holes` | `integer` | > 0 dan ≤ `grow_table.hole_count` |
| `current_stage_id` | `uuid` NULL | tahap milik komoditas yang sama (FK komposit) |
| `status` | `text` | `ACTIVE` → `COMPLETED`/`CANCELLED` |
| `expected_first_harvest_on` | `date` | default `seeded_on + variety.days_to_first_harvest` |
| `harvest_blocked_until` | `timestamptz` NULL | masa tunggu pestisida (PHI), diisi trigger `activity_input` |
| `ended_at`, `end_reason` | `timestamptz`, `text` NULL | `ended_at` terisi ⇔ bukan `ACTIVE`; `CANCELLED` wajib alasan |

`agro.cycle_stage_event` — FACT: `cycle_id`, `farm_id`, `greenhouse_id`, `stage_id → growth_stage`, `occurred_at`, `notes`.

`agro.activity` — FACT: `farm_id`, `greenhouse_id`, `target_scope GREENHOUSE/BLOCK/TABLE/RESERVOIR`,
`block_id`/`grow_table_id`/`reservoir_id` NULL (terisi sesuai `target_scope`, CHECK), `cycle_id` NULL (informasi),
`type NUTRIENT_MIX/PH_ADJUST/SPRAY/PRUNE/POLLINATE/TRELLIS/CLEAN/SEED/TRANSPLANT/OTHER`, `occurred_at`, `notes`.

`agro.activity_input` — FACT: `activity_id`, `farm_id`, `greenhouse_id`, `input_type`
(`NUTRIENT_A/NUTRIENT_B/PH_UP/PH_DOWN/PESTICIDE/FUNGICIDE/FOLIAR_FERTILIZER/OTHER`), `product_name`,
`active_ingredient` (wajib untuk `PESTICIDE/FUNGICIDE`), `quantity numeric(10,2) > 0`, `unit ML/L/G/KG`, `phi_days int ≥ 0`.

`agro.water_check` — FACT: `farm_id`, `greenhouse_id`, `reservoir_id`, `checked_at`, `ph numeric(4,2)` 0..14,
`ec_ms numeric(4,2)` 0..20, `water_temp_c numeric(4,1)` 0..50, `water_level_percent smallint` 0..100, `notes`;
minimal satu ukuran terisi.

`agro.task` — STATEFUL: `farm_id`, `greenhouse_id`, `block_id`/`grow_table_id`/`cycle_id` NULL (konsisten
dengan greenhouse), `title`, `description`, `type NUTRIENT_CHECK/SPRAY/HARVEST/MAINTENANCE/CLEANING/OTHER`,
`priority LOW/NORMAL/HIGH` (default `NORMAL`), `due_on`, `assignee_id` (WORKER aktif ber-assignment di greenhouse ini),
`status OPEN/IN_PROGRESS/DONE/CANCELLED`, `started_at`, `completed_at`, `completed_by`, `completion_notes`
(`DONE` ⇒ `completed_at` & `completed_by`).

`agro.issue` — STATEFUL: scope seperti `task`, `category PEST/DISEASE/NUTRIENT/EQUIPMENT/OTHER`, `title`,
`description`, `severity LOW/MEDIUM/HIGH/CRITICAL`, `status OPEN/IN_PROGRESS/RESOLVED`, `reported_at`,
`resolved_by`, `resolved_at`, `resolution_notes` (`RESOLVED` ⇒ `resolved_*` terisi). Pelapor = `created_by`.

`agro.harvest` — FACT, `id` dari klien: `farm_id`, `greenhouse_id`, `block_id`, `grow_table_id`, `variety_id`
(dari siklus), `cycle_id` (siklus belum berakhir sebelum `harvested_at`), `product_id` (→ `inventory.product`, FK di `06`;
komoditas & grade harus cocok), `grade A/B/C/REJECT`, `weight_g > 0`, `harvested_at`, `notes`, dan `phi_violation`
(dihitung trigger: `harvested_at < cycle.harvest_blocked_until`; nilai dari klien diabaikan).

## 2. Invarian

1. R-06: `planting_cycle_one_active_per_table` — partial unique `(grow_table_id) WHERE status='ACTIVE'`.
2. `planted_holes ≤ hole_count` meja → `PLANTED_HOLES_EXCEED`.
3. Event tahap: siklus harus `ACTIVE` (`CYCLE_NOT_ACTIVE`), tahap milik komoditas siklus (`STAGE_MISMATCH`);
   `current_stage_id` hanya diganti bila tidak ada event lain yang `occurred_at`-nya lebih baru (offline tidak mundur).
4. PHI: setiap `activity_input` dengan `phi_days > 0` menetapkan `harvest_blocked_until =
   GREATEST(lama, activity.occurred_at + phi_days hari)` pada semua siklus `ACTIVE` di cakupan kegiatan
   (meja / blok / greenhouse / semua meja yang dialiri tandon). Berjalan `SECURITY DEFINER` agar tidak
   ada siklus dalam cakupan yang terlewat karena RLS.
5. Panen dengan `phi_violation = true` tetap diterima (R-02); karantina lot di `06-inventory.md`.
   **Tidak retroaktif**: panen yang sudah tersimpan sebelum semprotan (offline) tiba tidak ditandai ulang.
6. Task: worker hanya boleh mengubah `status, started_at, completed_*` dan tidak boleh `CANCELLED` → `FORBIDDEN`;
   `assignee_id` tidak valid → `ASSIGNEE_INVALID`.
7. Transisi: siklus `ACTIVE>COMPLETED|CANCELLED`; task `OPEN>IN_PROGRESS|DONE|CANCELLED`,
   `IN_PROGRESS>DONE|CANCELLED`; issue `OPEN>IN_PROGRESS|RESOLVED`, `IN_PROGRESS>RESOLVED`. Status akhir beku.

## 3. DDL

```sql
-- 0006_agro_operations.sql
CREATE TABLE agro.planting_cycle (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  greenhouse_id uuid NOT NULL REFERENCES core.greenhouse (id),
  block_id uuid NOT NULL REFERENCES core.block (id),
  grow_table_id uuid NOT NULL REFERENCES core.grow_table (id),
  variety_id uuid NOT NULL,
  commodity_id uuid NOT NULL REFERENCES agro.commodity (id),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9-]{3,24}$'),
  seeded_on date NOT NULL,
  transplanted_on date,
  planted_holes integer NOT NULL CHECK (planted_holes > 0),
  current_stage_id uuid,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
  expected_first_harvest_on date,
  harvest_blocked_until timestamptz,
  ended_at timestamptz,
  end_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  FOREIGN KEY (variety_id, commodity_id) REFERENCES agro.variety (id, commodity_id),
  FOREIGN KEY (current_stage_id, commodity_id) REFERENCES agro.growth_stage (id, commodity_id),
  UNIQUE (farm_id, code),
  CHECK (transplanted_on >= seeded_on),
  CHECK ((status = 'ACTIVE') = (ended_at IS NULL)),
  CHECK (status <> 'CANCELLED' OR end_reason IS NOT NULL)
);
CREATE UNIQUE INDEX planting_cycle_one_active_per_table
  ON agro.planting_cycle (grow_table_id) WHERE status = 'ACTIVE';
CREATE INDEX planting_cycle_gh_status_idx ON agro.planting_cycle (greenhouse_id, status);

CREATE TABLE agro.cycle_stage_event (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  cycle_id uuid NOT NULL REFERENCES agro.planting_cycle (id),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  greenhouse_id uuid NOT NULL REFERENCES core.greenhouse (id),
  stage_id uuid NOT NULL REFERENCES agro.growth_stage (id),
  occurred_at timestamptz NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  device_id uuid REFERENCES iam.device (id)
);

CREATE TABLE agro.activity (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  greenhouse_id uuid NOT NULL REFERENCES core.greenhouse (id),
  target_scope text NOT NULL CHECK (target_scope IN ('GREENHOUSE', 'BLOCK', 'TABLE', 'RESERVOIR')),
  block_id uuid REFERENCES core.block (id),
  grow_table_id uuid REFERENCES core.grow_table (id),
  reservoir_id uuid REFERENCES core.reservoir (id),
  cycle_id uuid REFERENCES agro.planting_cycle (id),
  type text NOT NULL CHECK (type IN ('NUTRIENT_MIX', 'PH_ADJUST', 'SPRAY', 'PRUNE', 'POLLINATE',
    'TRELLIS', 'CLEAN', 'SEED', 'TRANSPLANT', 'OTHER')),
  occurred_at timestamptz NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  device_id uuid REFERENCES iam.device (id),
  CHECK (CASE target_scope
    WHEN 'GREENHOUSE' THEN num_nulls(block_id, grow_table_id, reservoir_id) = 3
    WHEN 'BLOCK' THEN block_id IS NOT NULL AND num_nulls(grow_table_id, reservoir_id) = 2
    WHEN 'TABLE' THEN grow_table_id IS NOT NULL AND reservoir_id IS NULL
    ELSE reservoir_id IS NOT NULL AND num_nulls(block_id, grow_table_id) = 2 END)
);
CREATE INDEX activity_gh_time_idx ON agro.activity (greenhouse_id, occurred_at);

CREATE TABLE agro.activity_input (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  activity_id uuid NOT NULL REFERENCES agro.activity (id),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  greenhouse_id uuid NOT NULL REFERENCES core.greenhouse (id),
  input_type text NOT NULL CHECK (input_type IN ('NUTRIENT_A', 'NUTRIENT_B', 'PH_UP', 'PH_DOWN',
    'PESTICIDE', 'FUNGICIDE', 'FOLIAR_FERTILIZER', 'OTHER')),
  product_name text NOT NULL CHECK (length(product_name) BETWEEN 1 AND 120),
  active_ingredient text,
  quantity numeric(10,2) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL CHECK (unit IN ('ML', 'L', 'G', 'KG')),
  phi_days integer NOT NULL DEFAULT 0 CHECK (phi_days >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  device_id uuid REFERENCES iam.device (id),
  CHECK (input_type NOT IN ('PESTICIDE', 'FUNGICIDE') OR active_ingredient IS NOT NULL)
);

CREATE TABLE agro.water_check (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  greenhouse_id uuid NOT NULL REFERENCES core.greenhouse (id),
  reservoir_id uuid NOT NULL REFERENCES core.reservoir (id),
  checked_at timestamptz NOT NULL,
  ph numeric(4,2) CHECK (ph BETWEEN 0 AND 14),
  ec_ms numeric(4,2) CHECK (ec_ms BETWEEN 0 AND 20),
  water_temp_c numeric(4,1) CHECK (water_temp_c BETWEEN 0 AND 50),
  water_level_percent smallint CHECK (water_level_percent BETWEEN 0 AND 100),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  device_id uuid REFERENCES iam.device (id),
  CHECK (num_nonnulls(ph, ec_ms, water_temp_c, water_level_percent) >= 1)
);
CREATE INDEX water_check_reservoir_time_idx ON agro.water_check (reservoir_id, checked_at);

CREATE TABLE agro.task (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  greenhouse_id uuid NOT NULL REFERENCES core.greenhouse (id),
  block_id uuid REFERENCES core.block (id),
  grow_table_id uuid REFERENCES core.grow_table (id),
  cycle_id uuid REFERENCES agro.planting_cycle (id),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  description text,
  type text NOT NULL CHECK (type IN ('NUTRIENT_CHECK', 'SPRAY', 'HARVEST', 'MAINTENANCE',
    'CLEANING', 'OTHER')),
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH')),
  due_on date,
  assignee_id uuid REFERENCES iam.user_account (id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED')),
  started_at timestamptz,
  completed_at timestamptz,
  completed_by uuid REFERENCES iam.user_account (id),
  completion_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CHECK (status <> 'DONE' OR (completed_at IS NOT NULL AND completed_by IS NOT NULL))
);
CREATE INDEX task_gh_status_idx ON agro.task (greenhouse_id, status);

CREATE TABLE agro.issue (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  greenhouse_id uuid NOT NULL REFERENCES core.greenhouse (id),
  block_id uuid REFERENCES core.block (id),
  grow_table_id uuid REFERENCES core.grow_table (id),
  cycle_id uuid REFERENCES agro.planting_cycle (id),
  category text NOT NULL CHECK (category IN ('PEST', 'DISEASE', 'NUTRIENT', 'EQUIPMENT', 'OTHER')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  description text,
  severity text NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED')),
  reported_at timestamptz NOT NULL,
  resolved_by uuid REFERENCES iam.user_account (id),
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CHECK (status <> 'RESOLVED' OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL))
);
CREATE INDEX issue_gh_status_idx ON agro.issue (greenhouse_id, status);

CREATE TABLE agro.harvest (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  farm_id uuid NOT NULL REFERENCES core.farm (id),
  greenhouse_id uuid NOT NULL REFERENCES core.greenhouse (id),
  block_id uuid NOT NULL REFERENCES core.block (id),
  grow_table_id uuid NOT NULL REFERENCES core.grow_table (id),
  cycle_id uuid NOT NULL REFERENCES agro.planting_cycle (id),
  variety_id uuid NOT NULL REFERENCES agro.variety (id),
  product_id uuid NOT NULL,
  grade text NOT NULL CHECK (grade IN ('A', 'B', 'C', 'REJECT')),
  weight_g integer NOT NULL CHECK (weight_g > 0),
  harvested_at timestamptz NOT NULL,
  phi_violation boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT iam.ctx_user_id() REFERENCES iam.user_account (id),
  device_id uuid REFERENCES iam.device (id)
);
CREATE INDEX harvest_gh_time_idx ON agro.harvest (greenhouse_id, harvested_at);

-- aturan khusus
CREATE FUNCTION agro.cycle_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_holes integer;
BEGIN
  SELECT t.hole_count INTO v_holes FROM core.grow_table t WHERE t.id = NEW.grow_table_id;
  IF NEW.planted_holes > v_holes THEN
    PERFORM meta.fail('PLANTED_HOLES_EXCEED', NEW.planted_holes || '>' || v_holes);
  END IF;
  IF TG_OP = 'INSERT' AND NEW.expected_first_harvest_on IS NULL THEN
    SELECT NEW.seeded_on + v.days_to_first_harvest INTO NEW.expected_first_harvest_on
    FROM agro.variety v WHERE v.id = NEW.variety_id;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION agro.apply_stage_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_commodity uuid;
BEGIN
  SELECT c.status, c.commodity_id INTO v_status, v_commodity
  FROM agro.planting_cycle c WHERE c.id = NEW.cycle_id;
  IF v_status IS DISTINCT FROM 'ACTIVE' THEN
    PERFORM meta.fail('CYCLE_NOT_ACTIVE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM agro.growth_stage s
      WHERE s.id = NEW.stage_id AND s.commodity_id = v_commodity) THEN
    PERFORM meta.fail('STAGE_MISMATCH');
  END IF;
  UPDATE agro.planting_cycle SET current_stage_id = NEW.stage_id
  WHERE id = NEW.cycle_id AND NOT EXISTS (SELECT 1 FROM agro.cycle_stage_event e
    WHERE e.cycle_id = NEW.cycle_id AND e.occurred_at > NEW.occurred_at);
  RETURN NULL;
END $$;

CREATE FUNCTION agro.apply_phi() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a agro.activity%ROWTYPE;
  v_until timestamptz;
BEGIN
  IF NEW.phi_days = 0 THEN
    RETURN NULL;
  END IF;
  SELECT * INTO a FROM agro.activity WHERE id = NEW.activity_id;
  v_until := a.occurred_at + make_interval(days => NEW.phi_days);
  UPDATE agro.planting_cycle c SET harvest_blocked_until = v_until
  WHERE c.status = 'ACTIVE' AND c.greenhouse_id = a.greenhouse_id
    AND (c.harvest_blocked_until IS NULL OR c.harvest_blocked_until < v_until)
    AND CASE a.target_scope
      WHEN 'GREENHOUSE' THEN true
      WHEN 'BLOCK' THEN c.block_id = a.block_id
      WHEN 'TABLE' THEN c.grow_table_id = a.grow_table_id
      ELSE c.grow_table_id IN (SELECT t.id FROM core.grow_table t
        WHERE t.reservoir_id = a.reservoir_id) END;
  RETURN NULL;
END $$;

CREATE FUNCTION agro.task_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_worker_cols text[] := ARRAY['status', 'started_at', 'completed_at', 'completed_by',
    'completion_notes', 'version', 'updated_at'];
BEGIN
  IF NEW.assignee_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id)
     AND NOT iam.is_worker_of_gh(NEW.assignee_id, NEW.greenhouse_id) THEN
    PERFORM meta.fail('ASSIGNEE_INVALID');
  END IF;
  IF TG_OP = 'UPDATE' AND iam.ctx_role() = 'WORKER' AND (NEW.status = 'CANCELLED'
      OR (to_jsonb(NEW) - v_worker_cols) <> (to_jsonb(OLD) - v_worker_cols)) THEN
    PERFORM meta.fail('FORBIDDEN', 'worker task update');
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION agro.harvest_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  c agro.planting_cycle%ROWTYPE;
BEGIN
  SELECT * INTO c FROM agro.planting_cycle WHERE id = NEW.cycle_id;
  IF c.status <> 'ACTIVE' AND c.ended_at < NEW.harvested_at THEN
    PERFORM meta.fail('CYCLE_NOT_ACTIVE');
  END IF;
  NEW.phi_violation := coalesce(NEW.harvested_at < c.harvest_blocked_until, false);
  RETURN NEW;
END $$;

-- pemasangan trigger
CALL meta.install_kind('agro.planting_cycle', 'STATEFUL');
CALL meta.install_kind('agro.cycle_stage_event', 'FACT');
CALL meta.install_kind('agro.activity', 'FACT');
CALL meta.install_kind('agro.activity_input', 'FACT');
CALL meta.install_kind('agro.water_check', 'FACT');
CALL meta.install_kind('agro.task', 'STATEFUL');
CALL meta.install_kind('agro.issue', 'STATEFUL');
CALL meta.install_kind('agro.harvest', 'FACT');

CALL meta.install_scope('agro.planting_cycle',
  'core.grow_table|grow_table_id|farm_id,greenhouse_id,block_id',
  'agro.variety|variety_id|commodity_id');
CALL meta.install_scope('agro.cycle_stage_event',
  'agro.planting_cycle|cycle_id|farm_id,greenhouse_id');
CALL meta.install_scope('agro.activity',
  'core.grow_table|grow_table_id|farm_id,greenhouse_id,block_id',
  'core.block|block_id|farm_id,greenhouse_id',
  'core.reservoir|reservoir_id|farm_id,greenhouse_id',
  'core.greenhouse|greenhouse_id|farm_id',
  'agro.planting_cycle|cycle_id|farm_id,greenhouse_id');
CALL meta.install_scope('agro.activity_input', 'agro.activity|activity_id|farm_id,greenhouse_id');
CALL meta.install_scope('agro.water_check', 'core.reservoir|reservoir_id|farm_id,greenhouse_id');
CALL meta.install_scope('agro.task',
  'agro.planting_cycle|cycle_id|farm_id,greenhouse_id,block_id,grow_table_id',
  'core.grow_table|grow_table_id|farm_id,greenhouse_id,block_id',
  'core.block|block_id|farm_id,greenhouse_id',
  'core.greenhouse|greenhouse_id|farm_id');
CALL meta.install_scope('agro.issue',
  'agro.planting_cycle|cycle_id|farm_id,greenhouse_id,block_id,grow_table_id',
  'core.grow_table|grow_table_id|farm_id,greenhouse_id,block_id',
  'core.block|block_id|farm_id,greenhouse_id',
  'core.greenhouse|greenhouse_id|farm_id');
CALL meta.install_scope('agro.harvest',
  'agro.planting_cycle|cycle_id|farm_id,greenhouse_id,block_id,grow_table_id,variety_id');

CALL meta.install_transitions('agro.planting_cycle', '{ACTIVE}',
  'ACTIVE>COMPLETED', 'ACTIVE>CANCELLED');
CALL meta.install_transitions('agro.task', '{OPEN}', 'OPEN>IN_PROGRESS', 'OPEN>DONE',
  'OPEN>CANCELLED', 'IN_PROGRESS>DONE', 'IN_PROGRESS>CANCELLED');
CALL meta.install_transitions('agro.issue', '{OPEN}', 'OPEN>IN_PROGRESS', 'OPEN>RESOLVED',
  'IN_PROGRESS>RESOLVED');

CREATE TRIGGER tg_40_check BEFORE INSERT OR UPDATE OF planted_holes ON agro.planting_cycle
  FOR EACH ROW EXECUTE FUNCTION agro.cycle_check();
CREATE TRIGGER tg_60_apply_stage AFTER INSERT ON agro.cycle_stage_event
  FOR EACH ROW EXECUTE FUNCTION agro.apply_stage_event();
CREATE TRIGGER tg_60_apply_phi AFTER INSERT ON agro.activity_input
  FOR EACH ROW EXECUTE FUNCTION agro.apply_phi();
CREATE TRIGGER tg_40_guard BEFORE INSERT OR UPDATE ON agro.task
  FOR EACH ROW EXECUTE FUNCTION agro.task_guard();
CREATE TRIGGER tg_40_check BEFORE INSERT ON agro.harvest
  FOR EACH ROW EXECUTE FUNCTION agro.harvest_check();
CALL meta.index_foreign_keys('agro');
```
