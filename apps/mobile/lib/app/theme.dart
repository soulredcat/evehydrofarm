import 'package:flutter/material.dart';

/// Tinggi/lebar minimum (dp) setiap kontrol yang bisa ditekan.
const double minTouchTarget = 48;

/// Hijau pertanian, warna dasar skema warna.
const Color agriGreen = Color(0xFF2E7D32);

/// Tema terang Material 3 untuk dipakai di lapangan.
///
/// - Skema warna diturunkan dari [agriGreen] dengan kontras dinaikkan
///   (`contrastLevel`) agar teks tetap terbaca di bawah sinar matahari.
/// - Semua tombol minimal [minTouchTarget] dp dan target sentuh `padded`.
ThemeData buildAppTheme() {
  final ColorScheme scheme = ColorScheme.fromSeed(
    seedColor: agriGreen,
    dynamicSchemeVariant: DynamicSchemeVariant.fidelity,
    contrastLevel: 0.5,
  );
  const Size buttonMinimumSize = Size(minTouchTarget * 2, minTouchTarget);
  const TextStyle buttonText = TextStyle(
    fontSize: 16,
    fontWeight: FontWeight.w600,
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: scheme.surface,
    materialTapTargetSize: MaterialTapTargetSize.padded,
    visualDensity: VisualDensity.standard,
    appBarTheme: AppBarThemeData(
      backgroundColor: scheme.primary,
      foregroundColor: scheme.onPrimary,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: buttonMinimumSize,
        textStyle: buttonText,
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        minimumSize: buttonMinimumSize,
        textStyle: buttonText,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: buttonMinimumSize,
        textStyle: buttonText,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        minimumSize: buttonMinimumSize,
        textStyle: buttonText,
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(
        minimumSize: const Size.square(minTouchTarget),
      ),
    ),
    inputDecorationTheme: const InputDecorationThemeData(
      border: OutlineInputBorder(),
      contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 16),
    ),
  );
}
