import 'package:eve_hydrofarm/app/env.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('alamat default App Pusat = host emulator Android port 4000', () {
    expect(Env.defaultApiBaseUrl, 'http://10.0.2.2:4000');
  });

  test(
    'apiBaseUrl = nilai --dart-define API_BASE_URL, atau default bila tidak di-set',
    () {
      const bool defined = bool.hasEnvironment('API_BASE_URL');
      const String expected = defined
          ? String.fromEnvironment('API_BASE_URL')
          : Env.defaultApiBaseUrl;
      expect(Env.apiBaseUrl, expected);
    },
  );
}
