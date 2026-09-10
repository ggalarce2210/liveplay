import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LivePlay — Jugá. Grabá. Reviví.',
  description: 'Reviví cada partido de Fútbol 5 y Pádel. Buscá tu partido, reproducilo en cámara lenta y compartí tus mejores jugadas.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
