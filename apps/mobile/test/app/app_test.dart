import 'package:eve_hydrofarm/app/app.dart';
import 'package:eve_hydrofarm/app/env.dart';
import 'package:eve_hydrofarm/app/router.dart';
import 'package:eve_hydrofarm/features/auth/screens/login_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('EveApp dibuka di / lalu dialihkan ke /masuk', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: EveApp()));
    await tester.pumpAndSettle();

    final BuildContext context = tester.element(find.byType(LoginScreen));
    final router = ProviderScope.containerOf(context).read(routerProvider);
    expect(router.routerDelegate.currentConfiguration.uri.path, '/masuk');
  });

  testWidgets('layar /masuk menyatakan dirinya kerangka', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: EveApp()));
    await tester.pumpAndSettle();

    expect(
      find.text('Kerangka aplikasi — login dibangun di milestone M7'),
      findsOneWidget,
    );
    expect(find.text('Eve Hydrofarm'), findsOneWidget);
    expect(find.text('App Pusat: ${Env.apiBaseUrl}'), findsOneWidget);
  });

  testWidgets('locale aplikasi id_ID dengan lokalisasi Material', (
    tester,
  ) async {
    await tester.pumpWidget(const ProviderScope(child: EveApp()));
    await tester.pumpAndSettle();

    final BuildContext context = tester.element(find.byType(LoginScreen));
    expect(Localizations.localeOf(context), const Locale('id', 'ID'));
    expect(
      MaterialLocalizations.of(context),
      isA<GlobalMaterialLocalizations>(),
    );
    expect(MaterialLocalizations.of(context).cancelButtonLabel, 'Batal');
  });
}
