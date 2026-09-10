import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });

  app.use(
    helmet({
      contentSecurityPolicy: false, // el frontend Next.js maneja su propia CSP
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // permite <video>/hls.js entre orígenes en dev
    }),
  );
  app.use(cookieParser());
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(','),
    credentials: true,
  });
  app.setGlobalPrefix('api');

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`🎬 LIVEPLAY API escuchando en http://localhost:${port}/api`);
}
bootstrap();
