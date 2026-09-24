import 'package:eve_hydrofarm/app/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Rasio kontras WCAG 2.x antara dua warna (1.0 sampai 21.0).
double contrastRatio(Color a, Color b) {
  final double la = a.computeLuminance();
  final double lb = b.computeLuminance();
  final double lighter = la > lb ? la : lb;
  final double darker = la > lb ? lb : la;
  return (lighter + 0.05) / (darker + 0.05);
}

Size minimumSizeOf(ButtonStyle? style) {
  final Size? size = style?.minimumSize?.resolve(<WidgetState>{});
  if (size == null) {
    throw StateError('minimumSize tidak diset di tema');
  }
  return size;
}

void main() {
  final ThemeData theme = buildAppTheme();
  final ColorScheme scheme = theme.colorScheme;

  test('tema terang Material 3 dengan target sentuh padded', () {
    expect(theme.useMaterial3, isTrue);
    expect(scheme.brightness, Brightness.light);
    expect(theme.materialTapTargetSize, MaterialTapTargetSize.padded);
  });

  test('semua jenis tombol minimal 48dp', () {
    expect(minTouchTarget, 48);
    final List<ButtonStyle?> styles = <ButtonStyle?>[
      theme.filledButtonTheme.style,
      theme.elevatedButtonTheme.style,
      theme.outlinedButtonTheme.style,
      theme.textButtonTheme.style,
      theme.iconButtonTheme.style,
    ];
    for (final ButtonStyle? style in styles) {
      final Size size = minimumSizeOf(style);
      expect(size.height, greaterThanOrEqualTo(48));
      expect(size.width, greaterThanOrEqualTo(48));
    }
  });

  test('teks isi di atas surface kontras >= 7:1 (WCAG AAA)', () {
    expect(contrastRatio(scheme.onSurface, scheme.surface), greaterThan(7));
  });

  test('teks di atas primary dan warna primary di surface >= 4.5:1', () {
    expect(contrastRatio(scheme.onPrimary, scheme.primary), greaterThan(4.5));
    expect(contrastRatio(scheme.primary, scheme.surface), greaterThan(4.5));
  });
}
