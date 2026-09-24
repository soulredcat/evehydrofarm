# Eve Hydrofarm — Mobile (Flutter)

Aplikasi HP untuk peran **WORKER**, **SELLER**, dan **SUPERVISOR**. Offline-first:
data lokal di SQLite (drift), perubahan ditulis ke outbox lalu disinkron ke App Pusat
(`apps/api`). Spesifikasi: `docs/spec/01-arsitektur.md`, `02-struktur-folder.md` §5,
`06-sinkronisasi.md`.

## Status: KERANGKA

Ini baru **kerangka**. Yang sudah ada:

- Paket terpin persis sesuai `docs/spec/01-arsitektur.md` (lihat `pubspec.yaml`).
- `lib/app/`: `EveApp` (MaterialApp.router, locale `id_ID`), router (`/` → `/masuk`),
  tema Material 3 hijau kontras tinggi (tombol ≥ 48dp), `Env.apiBaseUrl`.
- Layar `/masuk` yang hanya menyatakan bahwa aplikasi masih kerangka dan menampilkan
  alamat App Pusat yang terkonfigurasi.

Yang **belum** ada (dibangun di milestone **M7**, lihat `GOAL.md`): login, penyimpanan
token, DB lokal drift, outbox, sync engine, semua layar per peran, nota, cetak Bluetooth.
Paket `drift`, `dio`, `flutter_secure_storage`, dll. sudah terpasang tetapi belum dipakai.

## Prasyarat

- Flutter 3.41.4 / Dart 3.11.1, Android SDK, Java 17.
- Internet saat build/test pertama: hook `sqlite3` 3.x mengunduh biner SQLite
  (tanpa `sqlite3_flutter_libs`, paket itu sudah EOL).
- Android `minSdk = 24` (minimum dari `flutter_secure_storage` 11.2.0,
  `image_picker_android` 0.8.13+17, `flutter_plugin_android_lifecycle` 2.0.35).

## Perintah

Jalankan dari `apps/mobile`:

```sh
flutter pub get
dart format --output=none --set-exit-if-changed lib test
flutter analyze
flutter test
flutter build apk --debug
```

Menjalankan di emulator Android (default App Pusat `http://10.0.2.2:4000`):

```sh
flutter run
```

Menjalankan dengan alamat App Pusat lain:

```sh
flutter run --dart-define=API_BASE_URL=http://192.168.1.10:4000
```

`API_BASE_URL` dibaca saat kompilasi (`String.fromEnvironment`), jadi mengganti
alamat berarti menjalankan/build ulang.

## Struktur

Tata letak folder **mutlak** mengikuti `docs/spec/02-struktur-folder.md` §5:
`lib/app/`, `lib/data/{local,remote,sync}/`, `lib/features/<fitur>/`, `lib/ui_kit/`.
Folder baru dibuat saat ada kodenya (belum ada `lib/data/` dan `assets/images/`;
tidak ada folder kosong atau `.gitkeep`). `test/` mencerminkan `lib/`. Batas baris: `app/`, `screens/`, `widgets/`, `ui_kit/`,
`main.dart` ≤ 200; `data/**`, `*_repository.dart`, `*_providers.dart` ≤ 300;
maks 12 file per folder.
