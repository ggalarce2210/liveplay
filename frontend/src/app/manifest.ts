import type { MetadataRoute } from 'next';

// PWA manifest (App Router convention: se sirve automáticamente en /manifest.webmanifest).
// `background_color`/`theme_color` usan el mismo negro que el fondo de la app (ink-950,
// ver tailwind.config.js) para que la splash screen y la barra de estado del navegador
// no "salten" al color al abrir — la UI es dark-only (ver globals.css: color-scheme: dark).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'LivePlay — Jugá. Grabá. Reviví.',
    short_name: 'LivePlay',
    description:
      'Reviví cada partido de Fútbol 5 y Pádel. Buscá tu partido, reproducilo en cámara lenta y compartí tus mejores jugadas.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#06070a',
    theme_color: '#06070a',
    lang: 'es',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/maskable-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/maskable-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
