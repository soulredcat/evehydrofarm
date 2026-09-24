# Website (`@eve/web`)

Next.js: halaman publik + dashboard ADMIN, SUPERVISOR, SELLER. Tidak mengakses database —
hanya HTTP ke App Pusat (K-11, dijaga ESLint dan `tools/repo-check`).

**Status: kerangka.** Baru beranda publik sementara. Semua halaman, BFF auth, dan e2e dibangun di M6
(`docs/spec/07-website/`).

## Struktur

`src/app/` routing saja · `src/features/<fitur>/components|server` · `src/ui/` · `src/layout/` · `src/server/`.
Aturan: `docs/spec/02-struktur-folder.md` §3.

## Perintah

| Perintah                                    | Isi                    |
| ------------------------------------------- | ---------------------- |
| `pnpm --filter @eve/web dev`                | server dev port 3000   |
| `pnpm --filter @eve/web build`              | build produksi         |
| `pnpm --filter @eve/web lint` / `typecheck` | ESLint / typegen + tsc |
