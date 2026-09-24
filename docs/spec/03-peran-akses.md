# 03 — Peran, Cakupan & Matriks Akses

## 1. Peran dan cakupan (scope)

| Peran | Cakupan | Aplikasi | Isi `iam.user_assignment` |
|---|---|---|---|
| `ADMIN` | semua farm | Website, Monitoring | `farm_id = NULL`, `greenhouse_id = NULL` |
| `SUPERVISOR` | **tepat 1 farm** | Website, Mobile, Monitoring | `farm_id` wajib, `greenhouse_id = NULL` |
| `SELLER` | **tepat 1 farm** | Website, Mobile | `farm_id` wajib, `greenhouse_id = NULL` |
| `WORKER` | **tepat 1 greenhouse** (dan farm induknya) | Mobile, Monitoring | `farm_id` + `greenhouse_id` wajib, greenhouse milik farm itu |

Invarian yang ditegakkan database (bukan hanya aplikasi):
- Satu user punya **tepat satu** assignment aktif (`UNIQUE (user_id) WHERE revoked_at IS NULL`).
- `CHECK` bentuk assignment sesuai tabel di atas; trigger memastikan `greenhouse.farm_id = assignment.farm_id`.
- Memindah worker ke greenhouse lain = cabut assignment lama (`revoked_at`) + buat baru, dalam satu transaksi,
  dan menaikkan `iam.user_account.scope_version` (memaksa mobile reset data lokal, lihat `06-sinkronisasi.md`).
- User nonaktif (`is_active = false`) tidak bisa login dan semua refresh token-nya dicabut.

## 2. Aturan visibilitas baris (dipakai policy API **dan** RLS)

| Jenis baris | ADMIN | SUPERVISOR / SELLER | WORKER |
|---|---|---|---|
| Katalog global (komoditas, varietas, tahap, target nutrisi, produk) | ya | ya | ya |
| Baris ber-`farm_id` saja (farm, pelanggan, daftar harga) | ya | `farm_id = farm saya` | `farm_id = farm saya` |
| Baris ber-`greenhouse_id` (struktur, siklus, kegiatan, panen, lot, stok, ...) | ya | `farm_id = farm saya` | `greenhouse_id = greenhouse saya` |
| Penjualan (`sales.sale`) & pesanan (`sales.sales_order`) | ya | `farm_id = farm saya` | `greenhouse_id = greenhouse saya` (pesanan: yang ditugaskan ke GH saya) |
| Biaya (`costing.*`) | ya | SUPERVISOR: `farm_id = farm saya`; SELLER: **tidak** | **tidak** |
| Data monitoring | ya | SUPERVISOR: `farm_id = farm saya`; SELLER: **tidak** | `greenhouse_id = greenhouse saya` |

Setiap tabel bisnis yang terkait farm/greenhouse **menyimpan `farm_id` (dan `greenhouse_id` bila relevan)
secara denormalisasi**, diisi trigger dari induknya, agar RLS cukup membandingkan kolom (cepat dan pasti).

## 3. Matriks aksi

Legenda: **C** buat · **R** baca · **U** ubah · **A** setujui/tolak · **—** tidak boleh.
Kolom Worker selalu berarti "di greenhouse saya"; Supervisor/Seller "di farm saya".

| Entitas / aksi | ADMIN | SUPERVISOR | SELLER | WORKER |
|---|---|---|---|---|
| Farm | CRU | R | R | R (nama & kode) |
| Greenhouse, Blok, Meja | CRU | CRU | R | R |
| User & assignment | CRU semua peran | CRU untuk WORKER & SELLER farm-nya; pindah worker antar greenhouse farm-nya | — | R (diri sendiri) |
| Reset password | semua | WORKER & SELLER farm-nya | — | — |
| Katalog (komoditas, varietas, tahap, target, produk) | CRU | R | R | R |
| Daftar harga | CRU | CRU | R | R |
| Siklus tanam (buat, ganti tahap, selesai) | R | CRU | — | CRU |
| Kegiatan & cek air (append-only) | R | CR | — | CR |
| Aplikasi pestisida (bagian dari kegiatan) | R | CR | — | CR |
| Tugas | R | CRU (buat, tugaskan, batalkan) | — | R + U status (mulai/selesai) |
| Laporan masalah hama/penyakit | R | CRU (tangani, selesaikan) | — | CR |
| Panen (append-only) | R | CR | — | CR |
| Lot: karantina → rilis/buang | R | A | R | R |
| Pengajuan penyesuaian stok | R | C (langsung berlaku) + A | C | C |
| Selisih stok (`stock_discrepancy`) | R | A (selesaikan) | R | — |
| Pelanggan | R | CRU | CRU | CR |
| Penjualan (append-only) | R | CR | CR | CR (hanya lot greenhouse saya) |
| Pembayaran penjualan | R | CR | CR | CR (penjualan greenhouse saya) |
| Pengajuan void penjualan | R | C + A | C | C (penjualan buatan saya) |
| Laporan (produksi, penjualan, stok, piutang, produktivitas) | R semua farm | R farm | R penjualan/piutang/stok farm | R ringkasan greenhouse (mobile) |
| SKU & satuan jual (`sales.sku`) | CRU | R | R | R |
| Pesanan / pre-order (buat, ubah sebelum dipenuhi, batalkan, tugaskan ke GH, tutup) | R | CRU | CRU | R (ditugaskan ke GH saya) + penuhi lewat penjualan |
| Nota (lihat, bagikan, cetak) | R | R | R | R (penjualan GH saya) |
| Katalog bahan (`inventory.material`) | CRU | CR | R | R |
| Penerimaan bahan (dengan harga) | R | C | — | — |
| Pemakaian bahan (lewat kegiatan) | R | C | — | C |
| Transfer bahan antar-GH, opname bahan | R | C | — | — |
| Stok bahan (jumlah) | R | R | — | R |
| Biaya lain & alokasi (`costing.*`) | R | CR | — | — |
| Laporan HPP & laba (siklus/meja/blok/GH/komoditas) | R semua farm | R farm | — | — |
| Pesan kontak website (`site.inquiry`) | RU | — | — | — |
| Log audit | R | R farm | — | — |
| Monitoring: perangkat, sensor, ambang | CRU | CRU | — | R |
| Monitoring: alert | R + acknowledge | R + acknowledge | — | R + acknowledge |

## 4. Aturan khusus penjualan oleh worker (K-24)

1. Worker hanya bisa memilih **lot yang `greenhouse_id` = greenhouse saya** dan status `AVAILABLE`.
2. Setiap baris jual wajib menunjuk `lot_id`; lot menyimpan `block_id` & `grow_table_id`,
   sehingga nota dan laporan selalu bisa menampilkan **"Blok B · Meja 07"** per baris.
3. Pembeli wajib: pilih pelanggan terdaftar **atau** buat pelanggan baru cepat (nama + no HP opsional + tipe).
   Penjualan tanpa pelanggan tidak diperbolehkan (pelanggan umum = entri "Umum" per farm, dibuat seed).
4. Alur cepat **"Panen & Jual"** di mobile: satu layar membuat panen (lot baru) lalu penjualan dari lot itu,
   sebagai dua mutasi berurutan di outbox.

## 5. Penegakan di App Pusat

- Plugin `authenticate` memverifikasi JWT, lalu memuat assignment aktif dari DB
  (bukan dari token saja) dan menolak jika `scope_version` token ≠ DB (401 `SCOPE_CHANGED`).
- Plugin `request-scope` membuka transaksi per request dan menjalankan
  `SELECT set_config('app.user_id', $1, true), set_config('app.role', $2, true),
  set_config('app.farm_id', $3, true), set_config('app.greenhouse_id', $4, true)`.
  Semua query request itu berjalan di transaksi tersebut → RLS aktif.
- `<modul>.policy.ts` memeriksa aksi (kolom matriks §3) **sebelum** service berjalan dan
  mengembalikan 403 `FORBIDDEN_ROLE` atau `FORBIDDEN_SCOPE` (`05-api/00-konvensi.md` §3). RLS adalah jaring pengaman kedua:
  baris di luar scope → tidak terlihat (404) atau ditolak `WITH CHECK` (403).

## 6. Test wajib akses (minimal)

Harus ada test integrasi (Vitest, DB nyata) yang membuktikan, **melalui HTTP dan langsung di SQL sebagai `eve_api`**:
1. Worker GH-A tidak bisa membaca/menulis siklus, panen, lot, penjualan GH-B (farm sama).
2. Supervisor Farm-1 tidak bisa membaca apa pun milik Farm-2.
3. Seller tidak bisa membuat panen/kegiatan; worker tidak bisa menyetujui void/penyesuaian.
4. Worker tidak bisa menjual lot greenhouse lain walau `lot_id` dikirim manual.
5. Assignment ganda aktif untuk satu user ditolak oleh database.
6. Setelah worker dipindah greenhouse, token lama ditolak (`SCOPE_CHANGED`) dan pull meminta reset.
7. Tanpa `set_config` (konteks kosong), `eve_api` tidak melihat satu baris pun tabel bisnis.
8. WORKER dan SELLER tidak melihat satu baris pun `costing.*`; SUPERVISOR Farm-1 tidak melihat biaya Farm-2.
9. Worker hanya melihat pesanan yang ditugaskan ke greenhouse-nya.
