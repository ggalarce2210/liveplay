import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ServiceWorkerRegister } from './sw-register';

export const metadata: Metadata = {
  title: 'LivePlay — Jugá. Grabá. Reviví.',
  description: 'Reviví cada partido de Fútbol 5 y Pádel. Buscá tu partido, reproducilo en cámara lenta y compartí tus mejores jugadas.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    // "standalone" saca la barra de Safari cuando se agrega a la pantalla de inicio en
    // iOS — iOS no lee manifest.json para esto, necesita estos meta tags propios.
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'LivePlay',
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#06070a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
