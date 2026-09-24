/** Ringkasan monitoring. Status: kerangka — ingest, ambang, alert, dan grafik dibangun di M8 (09-monitoring/). */
export function OverviewPlaceholder() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6">
      <p className="text-sm font-semibold tracking-widest text-leaf-700 uppercase">
        Monitoring greenhouse
      </p>
      <h1 className="text-4xl font-bold sm:text-5xl">Eve Hydrofarm Monitoring</h1>
      <p className="text-lg text-stone-700">
        Pemantauan pH, EC, suhu, dan kelembapan setiap greenhouse NFT.
      </p>
      <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Ini kerangka awal aplikasi monitoring. Belum ada data sensor; fitur dibangun di milestone
        M8.
      </p>
    </main>
  );
}
