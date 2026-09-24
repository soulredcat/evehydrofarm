# 06 — Sinkronisasi Mobile ↔ App Pusat

Mobile bekerja **offline-first**. Semua tulis masuk outbox lokal; server adalah sumber kebenaran.
Keputusan terkait: K-30..K-35, R-01, R-02 (`00-keputusan-asumsi.md`). Tabel: `04-database/09-sync.md`.

## 1. Apa yang disinkron ke perangkat (per peran)

Server menyaring otomatis lewat RLS `sync.change_log` (kolom `visibility`). Klien tetap menyimpan
daftar tabel yang ia kenal; tabel tak dikenal diabaikan (maju-kompatibel).

| Tabel | WORKER | SELLER | SUPERVISOR |
|---|---|---|---|
| `core.farm`, `core.greenhouse`, `core.block`, `core.grow_table`, `core.reservoir` | GH saya (+ farm) | farm | farm |
| `agro.commodity`, `variety`, `growth_stage`, `nutrient_target`, `inventory.product` | ya | ya | ya |
| `agro.planting_cycle`, `cycle_stage_event`, `activity`, `activity_input`, `water_check`, `task`, `issue`, `harvest` | GH saya | — | farm |
| `inventory.lot`, `stock_movement`, `stock_adjustment` | GH saya | farm | farm |
| `inventory.stock_discrepancy` | — | farm | farm |
| `sales.customer`, `sku`, `price_list` | farm (`sku` global) | farm | farm |
| `sales.sales_order`, `sales_order_item` | ditugaskan ke GH saya | farm | farm |
| `inventory.material` (katalog) | ya | — | ya |
| `inventory.material_movement` (jumlah saja, tanpa harga) | GH saya | — | farm |
| `sales.sale`, `sale_item`, `payment`, `sale_void` | GH saya (`greenhouse_id` = saya) | farm | farm |
| `files.attachment` (metadata saja) | GH saya | farm | farm |
| `iam.user_account` (kolom aman: `id, username, full_name, role, is_active`) | diri sendiri | — | user farm |

Seller tidak menerima data operasional agro (hemat data). Kolom rahasia (`password_hash`) tidak pernah dikirim.
Schema `costing` dan harga penerimaan bahan **tidak pernah** disinkron (K-44).

## 2. Registrasi perangkat

`POST /v1/sync/devices` (sekali per instalasi, butuh login) → `{ deviceId, deviceCode }`.
`deviceCode` = 4 karakter base32 unik (dibuat server), dipakai untuk nomor nota & kode lot offline.
Disimpan di DB lokal tabel `device_info`. Logout tidak menghapus registrasi; reinstall = perangkat baru.

## 3. Pull (server → perangkat)

### 3.1 Kenapa kursor bukan `seq` saja

`bigserial` dibagikan saat INSERT, bukan saat COMMIT. Transaksi dengan `seq = 10` bisa commit **setelah**
transaksi `seq = 11`. Jika kursor hanya `seq`, klien yang sudah menerima 11 tidak akan pernah menerima 10.
Maka setiap baris `change_log` menyimpan `tx_id xid8 = pg_current_xact_id()` dan pull hanya
mengirim baris dari transaksi yang **pasti sudah selesai**: `tx_id < pg_snapshot_xmin(pg_current_snapshot())`.

### 3.2 Algoritma (wajib persis)

```text
GET /v1/sync/pull?cursor=<tx>:<seq>&limit=<n≤1000, default 500>      cursor awal = "0:0"

BEGIN (READ COMMITTED), set konteks RLS user
  xmin  := pg_snapshot_xmin(pg_current_snapshot())
  rows  := SELECT seq, tx_id, table_name, row_id FROM sync.change_log
           WHERE (tx_id, seq) > (:tx::xid8, :seq) AND tx_id < xmin     -- RLS menyaring visibility
           ORDER BY tx_id, seq LIMIT :n
  per table_name: SELECT kolom-sinkron FROM <tabel> WHERE id = ANY(:ids)  -- RLS berlaku
     baris ada & terlihat  → change { table, op: "UPSERT", row }
     baris tidak terlihat  → change { table, op: "REMOVE", id }         -- mis. pindah scope
  dedupe: satu (table,id) hanya sekali per halaman (keadaan terbaru)
  nextCursor := jika rows.length = n  → "<tx terakhir>:<seq terakhir>", hasMore = true
                jika rows.length < n  → "<xmin>:0",                      hasMore = false
COMMIT
```

Respons: `{ changes: [...], nextCursor, hasMore, serverTime, scopeVersion }`.
Urutan `changes` mengikuti urutan induk → anak dalam satu halaman (farm → greenhouse → … → sale → sale_item)
agar FK lokal tidak gagal; klien juga menonaktifkan pemeriksaan FK selama menerapkan satu halaman
(`PRAGMA defer_foreign_keys = ON` di transaksi drift).

### 3.3 Aturan klien

- Satu halaman diterapkan dalam **satu transaksi drift**, bersama penyimpanan `nextCursor`. Crash di tengah → tidak ada setengah halaman.
- `UPSERT` = insert or replace berdasar `id`. `REMOVE` = hapus baris lokal (dan anak lokalnya).
- Ulangi pull selama `hasMore = true`. Bootstrap perangkat baru = pull dari `"0:0"`.
- Format nilai: kolom nama **snake_case persis seperti DB**; `timestamptz` = ISO-8601 UTC; `date` = `YYYY-MM-DD`;
  `numeric` = **string** (presisi dipertahankan); `bigint` = number (server menjamin < 2^53).
- Jika `|serverTime − jam perangkat| > 5 menit` → banner peringatan "Jam HP tidak sesuai".

## 4. Push (perangkat → server)

### 4.1 Outbox lokal

Setiap aksi pengguna = **satu transaksi drift**: tulis baris lokal (optimistik, `pending_mutation_id` terisi)
+ satu entri `outbox(id, mutation_id uuid, type, payload_json, created_at, status, attempts, last_error)`.
Status: `PENDING` → `SENDING` → (hapus bila `APPLIED`/`DUPLICATE`) atau `FAILED` (ditolak) — urutan FIFO dijaga.

### 4.2 Permintaan

```text
POST /v1/sync/push
{ "deviceId": "...", "mutations": [ { "mutationId": "uuidv7", "type": "harvest.create",
  "payload": { ... kontrak Zod yang sama dengan endpoint REST ... }, "clientCreatedAt": "ISO" } ] }   // maks 100
```

Server memproses **berurutan**, masing-masing dalam transaksi sendiri dengan konteks RLS user:
1. `mutation_id` sudah ada di `sync.processed_mutation` → kembalikan hasil tersimpan, status `DUPLICATE`.
2. Validasi payload dengan skema Zod tipe itu → gagal: `REJECTED VALIDATION_FAILED`.
3. Panggil **fungsi service yang sama** dengan endpoint REST (satu jalur logika bisnis).
4. Simpan hasil ke `processed_mutation` dalam transaksi yang sama dengan perubahan data.

Respons per mutasi: `{ mutationId, status: APPLIED | DUPLICATE | REJECTED | CONFLICT, errorCode?, message?, serverRow? }`.
Satu mutasi gagal **tidak** menghentikan mutasi berikutnya. Mutasi yang bergantung pada entitas yang ditolak
akan gagal sendiri dengan `REFERENCE_NOT_FOUND`.

### 4.3 Daftar tipe mutasi (lengkap)

| Tipe | Peran | Catatan |
|---|---|---|
| `customer.create` | W, S, SP | pelanggan cepat, `id` dari klien |
| `cycle.create`, `cycle.advance_stage`, `cycle.complete`, `cycle.cancel` | W, SP | berstatus → `version` |
| `activity.create` (dengan `inputs[]`) | W, SP | PHI dihitung server |
| `water_check.create` | W, SP | |
| `task.create`, `task.cancel` | SP | |
| `task.update_status` (`IN_PROGRESS`/`DONE`) | W, SP | berstatus → `version` |
| `issue.create` | W, SP | |
| `issue.update_status` | SP | |
| `harvest.create` (dengan `lot { id, lotCode }` kecuali grade REJECT) | W, SP | PHI aktif → lot `QUARANTINED` (R-02) |
| `sale.create` (dengan `items[]`, opsional `initialPayment`) | W, S, SP | CASH wajib `initialPayment` = total |
| `payment.create` | W, S, SP | |
| `sale_void.request` / `sale_void.decide` | W,S,SP / SP | |
| `stock_adjustment.request` / `stock_adjustment.decide` | W,S,SP / SP | dari SP langsung `APPROVED` |
| `lot.release`, `lot.discard` | SP | untuk lot `QUARANTINED` |
| `discrepancy.resolve` | SP | |
| `attachment.register` | W, S, SP | metadata; file diunggah terpisah §6 |
| `order.create`, `order.update` (sebelum ada pemenuhan), `order.cancel`, `order.assign_greenhouse`, `order.close` | S, SP | berstatus → `version`; nomor `{farm}-PSN-{deviceCode}-{YYMMDD}-{NNN}` |
| `material_receipt.create` (dengan `totalCost`) | SP | harga masuk `costing`, tidak dikirim balik ke perangkat |
| `material_transfer.create`, `material_adjustment.create` | SP | opname = adjustment dengan `countedQuantity` |

`activity.create` boleh menyertakan `inputs[].materialId` + `quantity` (satuan dasar bahan) → server membuat
pemakaian bahan, nilai biaya (R-09), dan alokasi ke siklus (R-08). `sale.create` boleh menyertakan
`salesOrderId` dan `items[].salesOrderItemId` untuk pemenuhan pesanan.

W = WORKER, S = SELLER, SP = SUPERVISOR. Server tetap memeriksa matriks `03-peran-akses.md` §3.

### 4.4 Hasil di klien

| Status | Tindakan klien |
|---|---|
| `APPLIED` / `DUPLICATE` | hapus entri outbox; kosongkan `pending_mutation_id` (pull berikutnya membawa baris server) |
| `REJECTED` | entri → `FAILED` + `last_error`; baris optimistik hasil `create` ditandai `sync_state = 'rejected'` dan disembunyikan dari daftar normal; muncul di **Pusat Sinkron** dengan tombol "Buang" |
| `CONFLICT` | ganti baris lokal dengan `serverRow`, hapus entri outbox, tampilkan notifikasi "Data diubah orang lain" |
| error jaringan / 5xx | kembali `PENDING`, coba ulang dengan jeda 5 s, 15 s, 60 s, lalu maks 5 menit |
| 401 `TOKEN_EXPIRED` | refresh token lalu ulang; 401 `SCOPE_CHANGED` → §5 |

Mutasi `REJECTED` **tidak pernah** dikirim ulang otomatis.

## 5. Perubahan scope (worker dipindah greenhouse)

1. Server menaikkan `scope_version`; token lama → 401 `SCOPE_CHANGED`.
2. Klien refresh token (mendapat scope baru), lalu **push outbox** terlebih dahulu (mutasi untuk
   greenhouse lama akan `REJECTED FORBIDDEN_SCOPE` dan tampil di Pusat Sinkron).
3. Klien menghapus semua tabel data lokal + kursor (outbox `FAILED` dipertahankan), lalu bootstrap `"0:0"`.

## 6. Lampiran foto

1. Aksi yang memakai foto membuat `attachment.register` (id klien, `sha256`, `byte_size`, `mime_type`,
   `owner_type`, `owner_id`) → server menyimpan `status = PENDING_UPLOAD`.
2. File masuk antrean lokal `upload_queue`; saat online: `PUT /v1/files/:id/content` (maks 5 MB, JPEG/PNG/WebP;
   klien mengompres ke sisi terpanjang 1600 px). Server memverifikasi `sha256` & ukuran → `STORED`.
3. Antrean upload terpisah dari outbox: data bisnis tidak menunggu foto.

## 7. Penomoran offline

- Nota: `{farm.code}-{deviceCode}-{YYMMDD}-{NNN}` (contoh `LMB-7K2Q-260924-003`), `NNN` = penghitung per perangkat per hari.
- Lot: `{farm.code}{greenhouse.code}-{block.code}{grow_table.code}-{YYMMDD}-{deviceCode}{NN}`.
- Pesanan: `{farm.code}-PSN-{deviceCode}-{YYMMDD}-{NNN}`.
- Penghitung disimpan di tabel lokal `device_counter(key, date, value)` dan dinaikkan **dalam transaksi yang sama**
  dengan pembuatan entitas. Tanggal memakai `timezone` farm.
- Website/App Pusat memakai perangkat sistem cadangan `deviceCode = "WWWW"` (baris `iam.device` milik sistem, dibuat seed) + penghitung server per farm per hari (tabel penghitung dengan `UPDATE ... RETURNING` di bawah lock baris).

## 8. Aturan waktu

- `occurred_at`/`sold_at`/`harvested_at` = waktu perangkat saat aksi. `created_at` = waktu server.
- Server menolak waktu kejadian > `now() + 24 jam` (`REJECTED CLOCK_INVALID`). Waktu lampau diterima.

## 9. Test wajib sinkronisasi (App Pusat, Vitest + DB nyata)

1. **Celah urutan commit**: tx A (seq kecil) dibiarkan terbuka, tx B (seq besar) commit, pull → B **tidak** dikirim
   sebelum A selesai; setelah A commit, pull berikutnya mengirim A lalu B. Tidak ada baris yang terlewat.
2. **Idempoten**: push mutasi yang sama 2× (juga paralel) → 1 baris data, respons kedua `DUPLICATE`.
3. **Scope**: worker GH-A tidak pernah menerima baris GH-B; seller tidak menerima `agro.activity`;
   `iam.user_account` tidak pernah memuat `password_hash`.
4. **Halaman**: 1.200 perubahan dengan `limit=500` → 3 halaman, total unik = 1.200, kursor akhir `"<xmin>:0"`.
5. **REJECTED lanjut**: batch [valid, invalid, valid] → hasil [APPLIED, REJECTED, APPLIED].
6. **CONFLICT**: `task.update_status` dengan `version` basi → `CONFLICT` + `serverRow`.
7. **Panen & Jual offline**: `harvest.create` + `sale.create` (lot yang sama) dalam satu batch → keduanya APPLIED.
8. **Oversell offline**: dua perangkat menjual lot yang sama melebihi saldo → keduanya APPLIED, 1 `stock_discrepancy` OPEN (R-01).
9. **PHI**: panen di meja dengan `harvest_blocked_until` di masa depan → lot `QUARANTINED`; `sale.create` dari lot itu lewat sinkron → APPLIED + `stock_discrepancy` `SOLD_WHILE_NOT_SELLABLE` (R-13); lewat REST → 409 `LOT_NOT_SELLABLE`. Semprot yang tiba belakangan mengarantina lot panen di jendela PHI-nya (R-12).
10. **Pindah scope**: setelah assignment diganti → 401 `SCOPE_CHANGED`; pull dengan token baru hanya berisi GH baru.

Test sisi mobile (drift in-memory) ada di `08-mobile/`: penerapan halaman atomik, FIFO outbox, penanganan setiap status §4.4.
