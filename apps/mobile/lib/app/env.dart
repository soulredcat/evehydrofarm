/// Konfigurasi build-time yang dibaca dari `--dart-define`.
///
/// Nilai dibaca saat kompilasi (`String.fromEnvironment`), bukan saat runtime,
/// jadi mengganti alamat App Pusat berarti build/jalankan ulang aplikasi.
abstract final class Env {
  /// Alamat App Pusat dari emulator Android (`10.0.2.2` = localhost host).
  static const String defaultApiBaseUrl = 'http://10.0.2.2:4000';

  /// Alamat dasar App Pusat. Ganti dengan
  /// `--dart-define=API_BASE_URL=http://host:port`.
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: defaultApiBaseUrl,
  );
}
