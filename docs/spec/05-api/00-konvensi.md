# 05.00 — Konvensi API App Pusat & Peta Resource

Berlaku untuk `apps/api`. Detail request/response per resource ada di `05-api/01..06`.
Semua skema request/response didefinisikan **sekali** di `packages/contracts` (Zod) dan dipakai route + web + monitoring.

## 1. Dasar

- Base URL lokal `http://localhost:4000`. Semua endpoint bisnis di bawah prefix **`/v1`**.
  Tanpa prefix: `GET /health`, `GET /.well-known/jwks.json`, `GET /openapi.json`, `GET /docs`.
- JSON `camelCase` untuk body REST. **Pengecualian**: baris di `GET /v1/sync/pull` memakai nama kolom DB `snake_case` (lihat `06-sinkronisasi.md`).
- ID = UUID string. Uang = number rupiah utuh. Berat = number gram (`weightG`). Ukuran pH/EC/suhu = number (maks 2 desimal).
- Waktu = ISO-8601 dengan zona (`2026-09-24T03:15:00Z`). Tanggal = `YYYY-MM-DD` (menurut `timezone` farm).
- Header wajib respons: `x-request-id` (juga dicatat di log `pino`).

## 2. Autentikasi & konteks

- `Authorization: Bearer <accessToken>` untuk semua endpoint kecuali `/v1/auth/login`, `/v1/auth/refresh`, `/v1/public/*`, dan endpoint tanpa prefix.
- Plugin `authenticate` → plugin `request-scope` (transaksi + `set_config`, lihat `03-peran-akses.md` §5) → `policy` modul → `service`.
- Endpoint publik berjalan dengan konteks `app.role = 'ANON'`.

## 3. Format error (satu bentuk untuk semua)

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Berat harus lebih dari 0 gram.",
             "details": [{ "path": "items.0.weightG", "issue": "too_small" }], "requestId": "..." } }
```

| HTTP | `code` |
|---|---|
| 400 | `VALIDATION_FAILED`, `CLOCK_INVALID` |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `TOKEN_EXPIRED`, `TOKEN_REUSED`, `SCOPE_CHANGED`, `USER_INACTIVE` |
| 403 | `FORBIDDEN_ROLE` (peran tidak boleh aksi ini), `FORBIDDEN_SCOPE` (data di luar farm/greenhouse) |
| 404 | `NOT_FOUND` (juga untuk baris di luar scope yang disaring RLS) |
| 409 | `VERSION_CONFLICT` (+ `current` baris terbaru), `DUPLICATE_ID`, `INSUFFICIENT_STOCK`, `LOT_NOT_SELLABLE`, `CYCLE_ALREADY_ACTIVE`, `ALREADY_DECIDED`, `USERNAME_TAKEN` |
| 413 / 415 | `FILE_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE` |
| 422 | `BUSINESS_RULE` + `reason` (mis. `PLANTED_HOLES_EXCEED_CAPACITY`, `ASSIGNEE_NOT_IN_GREENHOUSE`) |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL` (pesan generik; detail hanya di log) |

Error DB `P0001` dengan `MESSAGE` = kode stabil (`04-database/00-konvensi.md` §4) dipetakan oleh
`plugins/error-handler.ts` melalui satu tabel pemetaan. Pesan untuk pengguna selalu Bahasa Indonesia.

## 4. List, filter, paginasi

- List memakai **cursor**: `?limit=50&cursor=<opaque>` (maks 200) → `{ "items": [...], "nextCursor": "..." | null }`.
- Urutan tetap per endpoint (default terbaru dulu, `(created_at desc, id desc)`); cursor = base64url dari kunci urut.
- Filter lewat query (`farmId`, `greenhouseId`, `status`, `from`, `to`, `q`). Filter di luar scope → 403 `FORBIDDEN_SCOPE`.

## 5. Tulis

- **Create** menerima `id` UUIDv7 dari klien (opsional di web; wajib di mutasi sync). `id` sama + payload sama → 200
  dengan data yang sudah ada (idempoten); `id` sama + payload beda → 409 `DUPLICATE_ID`.
- **Update entitas berstatus/master** wajib menyertakan `version`; beda → 409 `VERSION_CONFLICT` + `current`.
- **Fakta append-only** tidak punya endpoint update/delete. Koreksi lewat void/penyesuaian.
- Setiap service create/update dipakai bersama oleh endpoint REST **dan** handler mutasi sync (`06-sinkronisasi.md` §4.3).

## 6. Batas & keamanan

- Rate limit: login 10/menit per IP+username; `POST /v1/public/inquiries` 5/menit per IP; lainnya 600/menit per user.
- CORS: hanya origin `WEB` dan `MONITORING` dari env. Body JSON maks 1 MB; upload file maks 5 MB.
- Password: argon2id (`@node-rs/argon2`, parameter default library), minimal 8 karakter.
- Tidak ada data rahasia di log (password, token, `password_hash`, `device_key`).

## 7. Ekspor CSV

Endpoint laporan menerima `?format=csv` → `text/csv; charset=utf-8`, dengan BOM UTF-8, pemisah `;`
(ramah Excel lokal Indonesia), header kolom Bahasa Indonesia, angka tanpa pemisah ribuan.

## 8. Peta resource → modul

Modul dikelompokkan per **domain = nama schema DB**: `src/modules/<domain>/<modul>/`.

| Domain / modul | Endpoint (semua di bawah `/v1`) | Dok |
|---|---|---|
| `iam/auth` | `POST auth/login`, `POST auth/refresh`, `POST auth/logout`, `GET auth/me`, `POST auth/change-password`; `GET /.well-known/jwks.json` | 01 |
| `iam/users` | `GET/POST users`, `GET/PATCH users/:id`, `PUT users/:id/assignment`, `POST users/:id/reset-password` | 01 |
| `core/farms` | `GET/POST farms`, `GET/PATCH farms/:id`, `POST farms/:id/archive` | 02 |
| `core/greenhouses` | pola sama, `?farmId` | 02 |
| `core/reservoirs`, `core/blocks`, `core/grow-tables` | pola sama, `?greenhouseId`, `?blockId` | 02 |
| `agro/catalog` | `commodities`, `commodities/:id/varieties`, `commodities/:id/stages`, `nutrient-targets` (GET semua peran; tulis ADMIN) | 02 |
| `inventory/products` | `GET/POST products`, `PATCH products/:id` (tulis ADMIN) | 02 |
| `sales/skus` | `GET/POST skus`, `PATCH skus/:id` (satuan KG/IKAT/PACK/PCS; tulis ADMIN) | 02 |
| `sales/price-lists` | `GET price-lists?farmId&current=true`, `POST price-lists` (per SKU) | 02 |
| `sales/customers` | `GET/POST customers`, `PATCH customers/:id`, `POST customers/:id/archive` | 02 |
| `agro/cycles` | `GET/POST cycles`, `GET cycles/:id`, `POST cycles/:id/advance-stage`, `POST cycles/:id/complete`, `POST cycles/:id/cancel` | 03 |
| `agro/activities` | `GET/POST activities`, `GET activities/:id` (dengan `inputs`) | 03 |
| `agro/water-checks` | `GET/POST water-checks` | 03 |
| `agro/tasks` | `GET/POST tasks`, `POST tasks/:id/status`, `POST tasks/:id/cancel` | 03 |
| `agro/issues` | `GET/POST issues`, `POST issues/:id/status` | 03 |
| `agro/harvests` | `GET/POST harvests` (POST sekaligus membuat lot + `HARVEST_IN` lewat `inventory/lots`) | 03 |
| `inventory/lots` | `GET lots`, `GET lots/:id`, `POST lots/:id/release`, `POST lots/:id/discard` | 04 |
| `inventory/stock` | `GET stock/balances`, `GET stock/movements` | 04 |
| `inventory/stock-adjustments` | `GET/POST stock-adjustments`, `POST stock-adjustments/:id/decision` | 04 |
| `inventory/discrepancies` | `GET discrepancies`, `POST discrepancies/:id/resolve` | 04 |
| `sales/sales` | `GET/POST sales`, `GET sales/:id`, `POST sales/:id/payments` | 04 |
| `sales/sale-voids` | `GET/POST sale-voids`, `POST sale-voids/:id/decision` | 04 |
| `sales/receipts` | `GET sales/:id/receipt` (model data nota: farm, pelanggan, baris + blok/meja, pembayaran) | 04 |
| `sales/orders` | `GET/POST orders`, `GET/PATCH orders/:id`, `POST orders/:id/cancel`, `POST orders/:id/assign`, `POST orders/:id/close` | 04 |
| `inventory/materials` | `GET/POST materials`, `PATCH materials/:id`, `GET materials/balances`, `GET materials/movements` | 06 |
| `inventory/material-receipts` | `GET/POST material-receipts` (SUPERVISOR; harga ke `costing`) | 06 |
| `inventory/material-transfers`, `inventory/material-adjustments` | `GET/POST` (SUPERVISOR) | 06 |
| `costing/cost-entries` | `GET/POST cost-entries` (biaya lain; alokasi otomatis R-08) | 06 |
| `costing/profitability` | `GET costing/cycles`, `GET costing/profitability?groupBy=cycle\|table\|block\|greenhouse\|commodity` (+CSV) | 06 |
| `reports/approvals` | `GET approvals` (semua yang menunggu keputusan supervisor) | 04 |
| `reports/reports` | `GET reports/dashboard`, `reports/production`, `reports/sales`, `reports/stock`, `reports/receivables`, `reports/workers` | 05 |
| `files/attachments` | `POST files`, `PUT files/:id/content`, `GET files/:id/content` | 05 |
| `site/public` | `GET public/products`, `GET public/farms`, `POST public/inquiries` (tanpa auth) | 05 |
| `site/inquiries` | `GET inquiries`, `POST inquiries/:id/status` (ADMIN) | 05 |
| `audit/audit-logs` | `GET audit-logs` | 05 |
| `sync/devices`, `sync/pull`, `sync/push` | `POST sync/devices`, `GET sync/pull`, `POST sync/push` | 05 + `06-sinkronisasi.md` |
| `system/health` | `GET /health` (cek DB) | 05 |

Nama file peran di dalam modul memakai nama modul: `modules/agro/harvests/harvests.service.ts`.
Satu modul tidak menulis tabel milik modul lain kecuali lewat service modul pemilik
(mis. `harvests.service` memanggil `lots.service.createFromHarvest`). Folder domain hanya berisi folder modul.
