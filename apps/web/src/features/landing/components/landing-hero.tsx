/** Hero beranda publik. Status: kerangka — konten final di M6 (07-website/01-publik.md). */
export function LandingHero() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6">
      <p className="text-sm font-semibold tracking-widest text-leaf-700 uppercase">
        Hidroponik NFT
      </p>
      <h1 className="text-4xl font-bold sm:text-5xl">Eve Hydrofarm</h1>
      <p className="text-lg text-stone-700">
        Cabai, tomat, dan sayur daun segar dari greenhouse hidroponik kami.
      </p>
      <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Situs sedang dibangun. Ini kerangka awal; halaman lengkap dibangun di milestone M6.
      </p>
    </main>
  );
}
