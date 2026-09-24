import 'package:flutter/material.dart';

import '../../../app/env.dart';
import '../../../ui_kit/app_logo.dart';

/// Layar masuk — MASIH KERANGKA.
///
/// Belum ada form login, panggilan ke App Pusat, maupun penyimpanan token.
/// Layar ini hanya menyatakan statusnya dan alamat App Pusat yang
/// terkonfigurasi. Login sebenarnya dibangun di milestone M7 (GOAL.md).
class LoginScreen extends StatelessWidget {
  const LoginScreen({super.key});

  /// Teks yang menyatakan bahwa aplikasi masih kerangka.
  static const String scaffoldNotice =
      'Kerangka aplikasi — login dibangun di milestone M7';

  @override
  Widget build(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                const AppLogo(),
                const SizedBox(height: 32),
                Text(
                  scaffoldNotice,
                  textAlign: TextAlign.center,
                  style: text.titleMedium,
                ),
                const SizedBox(height: 16),
                Text(
                  'App Pusat: ${Env.apiBaseUrl}',
                  textAlign: TextAlign.center,
                  style: text.bodyLarge,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
