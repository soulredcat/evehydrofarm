import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Eve Hydrofarm',
  description: 'Cabai, tomat, dan sayur daun dari greenhouse hidroponik NFT.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body className="antialiased">{children}</body>
    </html>
  );
}
