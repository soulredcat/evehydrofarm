import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/screens/login_screen.dart';

/// Path rute aplikasi. Segmen URL memakai Bahasa Indonesia.
abstract final class AppRoutes {
  static const String root = '/';
  static const String login = '/masuk';
}

/// Router aplikasi.
///
/// Kerangka: `/` selalu dialihkan ke `/masuk`. Pengalihan berdasarkan sesi
/// login dan peran (worker/seller/supervisor) dibangun di milestone M7.
final Provider<GoRouter> routerProvider = Provider<GoRouter>((ref) {
  final GoRouter router = GoRouter(
    initialLocation: AppRoutes.root,
    routes: <RouteBase>[
      GoRoute(
        path: AppRoutes.root,
        redirect: (context, state) => AppRoutes.login,
      ),
      GoRoute(
        path: AppRoutes.login,
        builder: (context, state) => const LoginScreen(),
      ),
    ],
  );
  ref.onDispose(router.dispose);
  return router;
});
