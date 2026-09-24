import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../ui_kit/app_logo.dart';
import 'router.dart';
import 'theme.dart';

/// Widget akar aplikasi: tema, locale Indonesia, dan router.
class EveApp extends ConsumerWidget {
  const EveApp({super.key});

  /// Locale satu-satunya yang didukung aplikasi.
  static const Locale locale = Locale('id', 'ID');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: AppLogo.appName,
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      locale: locale,
      supportedLocales: const <Locale>[locale],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      routerConfig: router,
    );
  }
}
