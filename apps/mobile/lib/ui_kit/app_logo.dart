import 'package:flutter/material.dart';

/// Logo aplikasi: ikon daun dan nama aplikasi.
class AppLogo extends StatelessWidget {
  const AppLogo({super.key});

  /// Nama aplikasi yang tampil ke pengguna.
  static const String appName = 'Eve Hydrofarm';

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final Color color = theme.colorScheme.primary;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(Icons.eco, size: 72, color: color),
        const SizedBox(height: 8),
        Text(
          appName,
          textAlign: TextAlign.center,
          style: theme.textTheme.headlineMedium?.copyWith(
            color: color,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }
}
