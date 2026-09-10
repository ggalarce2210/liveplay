/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // En desarrollo, proxyeamos /api hacia el backend NestJS para evitar configurar CORS
    // por separado en cada request del cliente (el backend igual tiene CORS habilitado
    // por si se lo llama directo). En producción esto se resuelve con el mismo dominio
    // detrás de un reverse proxy (ver docker-compose.yml / ARCHITECTURE.md).
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
