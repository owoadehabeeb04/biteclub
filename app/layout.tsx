import type { Metadata, Viewport } from 'next';
import './globals.css';
import Providers from './Providers';

export const metadata: Metadata = {
  title: 'BITECLUB',
  description: 'Bite. Survive. Dominate.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, themeColor: '#0A130E' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Same Google Fonts link as the design pages, so canvas text can use the plain family names */}
        <link href="https://fonts.googleapis.com/css2?family=Bungee&family=Rubik:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      </head>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
