import type { Metadata } from 'next';
import { Fraunces, Inter, JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';
import { SettingsProvider } from '../lib/settings';
import { SiteChrome } from '../components/ui';

// Tipografi: landing v23 + panel pakai Plus Jakarta Sans & JetBrains Mono.
// Fraunces dipertahankan karena class .serif (member/subscription) dan
// aturan h1-h3 global masih memakainya; menghapusnya mengubah heading
// panel menjadi Georgia.
const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-serif',
  display: 'swap',
});
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://mutasi.rajacek.com'),
  title: 'MutasiHub — Cek Mutasi DANA & BCA Realtime untuk Bisnis Modern',
  description:
    'Pantau mutasi DANA dan BCA secara realtime untuk top-up, deposit, dan rekonsiliasi otomatis. Read-only, kredensial terenkripsi AES-256.',
  openGraph: {
    title: 'MutasiHub — Cek Mutasi DANA & BCA Realtime',
    description:
      'Mutasi DANA & BCA masuk otomatis ke dashboard. Trial 1 hari gratis — tanpa kartu kredit.',
    url: 'https://mutasi.rajacek.com',
    siteName: 'MutasiHub',
    locale: 'id_ID',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'MutasiHub — Cek Mutasi DANA & BCA Realtime',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MutasiHub — Cek Mutasi DANA & BCA Realtime',
    description:
      'Mutasi DANA & BCA masuk otomatis ke dashboard. Trial 1 hari gratis — tanpa kartu kredit.',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id" className={`scroll-smooth ${fraunces.variable} ${inter.variable} ${jakarta.variable} ${jetbrainsMono.variable}`}>
      <body>
        <SettingsProvider>
          <SiteChrome>{children}</SiteChrome>
        </SettingsProvider>
      </body>
    </html>
  );
}
