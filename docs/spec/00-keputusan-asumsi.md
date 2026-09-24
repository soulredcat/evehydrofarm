# 00 — Keputusan & Asumsi

Dokumen ini mengunci keputusan yang **tidak boleh diubah oleh agen pelaksana**.
Jika operator ingin mengubah salah satunya, ubah di sini dulu, baru jalankan `/goal`.
Setiap keputusan diberi ID (`K-xx`) agar bisa dirujuk dari dokumen lain.

## Produk

| ID | Keputusan |
|---|---|
| K-01 | Nama produk: **Eve Hydrofarm**. Sistem smart greenhouse hidroponik model **NFT** (Nutrient Film Technique). |
| K-02 | Komoditas awal: cabai (rawit, merah keriting, merah besar), tomat (cherry, beef), sayur daun (selada, pakcoy, kangkung, bayam, sawi). Katalog bisa ditambah admin tanpa ubah kode. |
| K-03 | Satu perusahaan (single-tenant), **banyak farm**. Farm → Greenhouse → Blok → Meja (**dikonfirmasi operator**); tandon nutrisi (reservoir) per greenhouse. Tidak ada tabel organisasi/tenant. |
| K-04 | Bahasa UI: **Bahasa Indonesia**. Nama kode, tabel, kolom, endpoint: **Bahasa Inggris** `snake_case`/`camelCase`. |
| K-05 | Zona waktu default `Asia/Jakarta`; tiap farm punya kolom `timezone` sendiri (WIB/WITA/WIT). Semua waktu disimpan `timestamptz` (UTC). |
| K-06 | Berat disimpan dalam **gram** (`integer`/`bigint`), uang dalam **rupiah utuh** (`bigint`). Tidak ada `float` untuk berat/uang. |

## Empat aplikasi terpisah + satu database

| ID | Keputusan |
|---|---|
| K-10 | **App Pusat** (`apps/api`): backend TypeScript, satu-satunya pemilik logika bisnis & penulis data bisnis. Semua aplikasi lain sinkron/bicara ke sini. |
| K-11 | **Website** (`apps/web`): Next.js. Halaman publik + dashboard (admin pusat, supervisor, seller). **Tidak** mengakses database langsung — hanya lewat HTTP ke App Pusat. |
| K-12 | **Mobile** (`apps/mobile`): **Flutter** (Dart). Untuk worker, seller, supervisor. **Offline-first**, database lokal SQLite (drift), sinkron ke App Pusat. |
| K-13 | **Monitoring** (`apps/monitoring`): aplikasi sendiri (Next.js, UI + endpoint ingest sensor). Pemilik schema `monitoring`. Hanya **membaca** struktur farm/greenhouse dari schema `core`. Tidak menulis data bisnis. |
| K-14 | Database: **satu** PostgreSQL 18, database `evehydrofarm`, dipecah per domain dengan **PostgreSQL schema**: `meta`, `iam`, `core`, `agro`, `inventory`, `sales`, `costing`, `files`, `site`, `sync`, `audit`, `monitoring`. |
| K-15 | Bahasa: **TypeScript saja** untuk semua kode non-mobile (api, web, monitoring, db, tools, script). Mobile: Dart/Flutter. Tidak ada Python, Go, Java, dsb. di repo. |
| K-16 | Tidak ada Docker (tidak terpasang di mesin operator). Postgres lokal (service Windows `postgresql-x64-18`, port 5432). |

## Akses (aturan bisnis mutlak)

| ID | Keputusan |
|---|---|
| K-20 | Peran: `ADMIN` (pusat), `SUPERVISOR`, `SELLER`, `WORKER`. Satu user = satu peran. |
| K-21 | **1 worker = 1 greenhouse.** Worker hanya melihat & menulis data greenhouse-nya. |
| K-22 | **1 supervisor = 1 farm.** Supervisor melihat & mengelola seluruh greenhouse di farm-nya saja. Satu farm boleh punya lebih dari satu supervisor. |
| K-23 | **Seller = 1 farm** (**dikonfirmasi operator**). Seller menjual dari stok semua greenhouse di farm-nya. |
| K-24 | **Worker boleh menjual**, hanya dari stok greenhouse-nya, dan wajib mencatat **blok & meja asal** serta **pembeli**. |
| K-25 | `ADMIN` melihat semua farm. Admin hanya memakai website (tidak ada mode admin di mobile). |
| K-26 | Pembatasan akses ditegakkan **dua lapis**: (1) policy di App Pusat, (2) **Row Level Security** PostgreSQL. Satu lapis bocor tidak boleh membuka data. |
| K-27 | Worker tidak memakai website dashboard (login worker di web ditolak dengan pesan "Gunakan aplikasi mobile"). |

## Sinkronisasi

| ID | Keputusan |
|---|---|
| K-30 | Mobile menulis semua perubahan ke **outbox lokal** lalu `push` ke App Pusat; menerima perubahan lewat `pull` berbasis kursor. Detail: `06-sinkronisasi.md`. |
| K-31 | ID semua entitas yang bisa dibuat offline = **UUIDv7 dibuat di klien**. Server tidak mengganti ID. |
| K-32 | Data fakta (panen, penjualan, pembayaran, kegiatan, cek air, laporan masalah, pergerakan stok) **append-only**: tidak pernah di-update isinya, koreksi lewat dokumen pembalik (void/adjustment). Ini menghapus konflik tulis. |
| K-33 | Data master (farm, greenhouse, blok, meja, komoditas, harga) hanya diubah dari website oleh ADMIN/SUPERVISOR. Mobile hanya membaca. |
| K-34 | Data yang bisa berubah status (tugas, siklus tanam, masalah) memakai `version` optimistik. Versi basi → konflik → **server menang**, klien menerima baris server. |
| K-35 | Nomor nota penjualan dibuat di klien tanpa server: `{KODEFARM}-{KODEPERANGKAT}-{YYMMDD}-{NNN}`; kode perangkat diberikan server saat registrasi perangkat. |

## Fitur tambahan (dikonfirmasi operator 2026-09-24)

| ID | Keputusan |
|---|---|
| K-40 | **Satuan jual**: `KG`, `IKAT`, `PACK`, `PCS`. Stok selalu dalam **gram**. Barang jual = **SKU** (`sales.sku`) = produk (komoditas × grade) + satuan + `unit_weight_g` (wajib untuk non-KG, mis. pack selada 250 g). Daftar harga per SKU. Baris jual menyimpan `quantity` (jumlah satuan) **dan** `weight_g` (gram yang mengurangi stok lot). |
| K-41 | **Pesanan / pre-order** (`sales.sales_order`): pelanggan memesan SKU + jumlah untuk tanggal kirim tertentu; boleh ditugaskan ke satu greenhouse (worker GH itu melihatnya); dipenuhi oleh satu atau lebih penjualan yang menunjuk baris pesanan. Pesanan **tidak** mengunci stok. |
| K-42 | **Nota**: dibuat dari data lokal (bisa offline). Mobile: bagikan sebagai **gambar PNG / PDF** lewat share sheet (WhatsApp, dll.) dan **cetak ESC/POS 58 mm via Bluetooth**. Website: halaman nota siap cetak (CSS print A5 & 58 mm) → "Cetak / Simpan PDF" lewat dialog cetak browser. Isi nota wajib menampilkan **blok & meja asal** per baris. |
| K-43 | **Bahan & biaya**: katalog bahan (AB mix, benih, rockwool, pestisida, dll., satuan dasar `G`/`ML`/`PCS`); stok bahan **per greenhouse** (ledger `inventory.material_movement`); penerimaan bahan **dengan harga** dicatat SUPERVISOR; pemakaian lewat kegiatan (`activity_input.material_id`); transfer antar-greenhouse & opname oleh SUPERVISOR; biaya lain (tenaga kerja, listrik, air, perawatan) di schema `costing`; semua biaya dialokasikan ke siklus → **HPP & laba per siklus / meja / blok / greenhouse / komoditas**. |
| K-44 | Data biaya (`costing.*`, harga penerimaan bahan) hanya untuk ADMIN & SUPERVISOR, **tidak** disinkron ke mobile; laporan HPP/laba hanya di website. Mobile hanya melihat **jumlah** stok bahan. |

## Keputusan risiko bisnis (operator boleh ubah sebelum `/goal`)

| ID | Default yang dipakai | Alternatif |
|---|---|---|
| R-01 | Penjualan offline yang membuat stok lot minus **diterima**, lalu dibuat `inventory.stock_discrepancy` status `OPEN` untuk diselesaikan supervisor. Penjualan online (website) yang melebihi stok **ditolak** (409). | Tolak semua penjualan minus. |
| R-02 | Panen saat masa tunggu pestisida (PHI) masih aktif: data **diterima**, lot otomatis `QUARANTINED` (tidak bisa dijual) sampai supervisor `RELEASE` atau `DISCARD`. | Tolak panen. |
| R-03 | Harga jual boleh diubah penjual; baris ditandai `price_overridden = true` dan muncul di laporan. Tidak ada persetujuan diskon. | Wajib persetujuan jika diskon > X%. |
| R-04 | Void penjualan: diajukan seller/worker dengan alasan, **disetujui supervisor**; stok dikembalikan lewat pergerakan pembalik. Penjualan tidak pernah diedit. | Seller boleh void sendiri < 1 jam. |
| R-05 | Penyesuaian stok (susut, rusak, selisih timbang) diajukan worker/seller, disetujui supervisor. Pengajuan dari supervisor langsung berlaku. | Semua langsung berlaku. |
| R-06 | Satu meja hanya punya **satu siklus tanam aktif** pada satu waktu. | Tanam campur per meja. |
| R-07 | Pemakaian bahan offline yang membuat stok bahan minus **diterima**; saldo minus ditandai merah di laporan stok bahan, dikoreksi lewat opname supervisor. | Tolak pemakaian. |
| R-08 | Alokasi biaya: target `TABLE`/`CYCLE` → siklus aktif meja itu; `BLOCK`/`GREENHOUSE` → dibagi ke siklus aktif di dalamnya **proporsional `planted_holes`** (sisa pembulatan ke siklus terbesar); tidak ada siklus aktif → **overhead greenhouse** (tidak teralokasi, tetap tampil di laporan). | Alokasi rata. |
| R-09 | Nilai pemakaian bahan = jumlah × **harga rata-rata tertimbang per farm** saat mutasi diproses server (bukan saat offline). Harga rata-rata diperbarui setiap penerimaan. | FIFO. |
| R-10 | Pemenuhan pesanan boleh melebihi jumlah pesanan (tercatat di laporan pemenuhan); pesanan `CLOSED` otomatis bila semua baris terpenuhi, bisa ditutup manual. | Tolak kelebihan. |
| R-12 | **PHI retroaktif**: jika kegiatan semprot (dengan PHI) tiba lewat sinkron **setelah** panen yang jatuh di dalam jendela PHI-nya (`occurred_at` ≤ `harvested_at` < `occurred_at + phi_days`) pada meja yang sama, lot panen itu yang masih `AVAILABLE` otomatis → `QUARANTINED` (alasan `PHI_RETROACTIVE`); bagian yang sudah terjual ditandai di laporan "terjual dalam masa PHI" untuk penelusuran. | Tidak retroaktif. |
| R-13 | Penjualan lewat **sinkron** dari lot yang saat diproses server sudah `QUARANTINED`/`DISCARDED` **diterima** (transaksi fisik sudah terjadi, jejak wajib ada) dan dibuat `stock_discrepancy` jenis `SOLD_WHILE_NOT_SELLABLE` untuk supervisor. Lewat website/REST **ditolak** 409 `LOT_NOT_SELLABLE`. Mobile memblokir bila status lot lokal sudah tidak `AVAILABLE`. | Tolak juga di sinkron. |
| R-14 | Void penjualan yang lotnya sudah `DISCARDED`: barang kembali dicatat `SALE_VOID_IN` lalu langsung `DISCARD_OUT` jumlah yang sama (saldo lot tetap 0, jejak tetap lengkap). | Tolak void. |
| R-11 | Pendapatan per siklus = total baris jual dari lot siklus itu dikurangi diskon nota yang dibagi proporsional ke baris; penjualan yang di-void tidak dihitung. | — |

## Di luar cakupan (jangan dibangun)

- Absensi, penggajian, akuntansi umum (jurnal, neraca, pajak), manajemen supplier, purchase order ke supplier, hutang supplier.
- Toko online / checkout publik / payment gateway. Website publik hanya katalog + form kontak.
- Notifikasi push (FCM), WhatsApp, Telegram, email.
- MQTT pada monitoring (ingest hanya HTTP; jembatan MQTT = pekerjaan berikutnya).
- Kontrol aktuator otomatis (pompa, dosing). Monitoring hanya membaca & memberi alert.
- Aplikasi iOS build (kode Flutter tetap lintas platform, tetapi verifikasi hanya Android + `flutter test`).
- Deploy produksi / CI cloud (**dikonfirmasi operator: lokal dulu**, deploy = goal terpisah). Semua verifikasi berjalan lokal di Windows.
- Uji cetak fisik ke printer Bluetooth tidak bisa diotomasi: DoD membuktikan **byte ESC/POS** dan file PNG/PDF yang dihasilkan; uji printer fisik dilakukan manual oleh operator.

## Prasyarat operator (sebelum `/goal`)

1. Salin `.env.example` → `.env` dan isi `DATABASE_ADMIN_URL` dengan user superuser Postgres
   (mis. `postgres://postgres:<password>@localhost:5432/postgres`). Agen **tidak** menebak password.
2. Tooling yang sudah terpasang dan menjadi acuan versi: Node 22.22, pnpm 10.13, PostgreSQL 18,
   Flutter 3.41.4 / Dart 3.11.1, Android SDK (platform 31–36), Java 17, Chrome.
