# Monitoring (`@eve/monitoring`)

Aplikasi terpisah untuk sensor greenhouse: ingest pembacaan, ambang, alert, grafik (K-13).
Pemilik schema `monitoring`; hanya membaca struktur farm dari schema `core`.

**Status: kerangka.** Baru halaman ringkasan sementara. Ingest `X-Device-Key`, alert, UI, auth via JWKS
App Pusat, dan simulator sensor dibangun di M8 (`docs/spec/09-monitoring/`).

## Struktur

Sama dengan Website, ditambah `simulator/` dan `test/`. Aturan: `docs/spec/02-struktur-folder.md` §4.

## Perintah

| Perintah                                           | Isi                    |
| -------------------------------------------------- | ---------------------- |
| `pnpm --filter @eve/monitoring dev`                | server dev port 3100   |
| `pnpm --filter @eve/monitoring build`              | build produksi         |
| `pnpm --filter @eve/monitoring lint` / `typecheck` | ESLint / typegen + tsc |
