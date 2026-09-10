/**
 * Seed de demostración: crea el complejo "Deportivo San Martín", sus canchas y cámaras, un jugador
 * demo, dos partidos (Fútbol 5 y Pádel) con equipos/eventos, y dispara el pipeline real de
 * FFmpeg sobre los videos sintéticos de /sample-media para dejar todo reproducible de punta
 * a punta (§37 — seed antes de desarrollar la UI).
 */
import 'dotenv/config';
import * as path from 'path';
import * as bcrypt from 'bcrypt';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { FfmpegService } from '../video-processing/ffmpeg.service';
import { LocalDiskStorageDriver } from '../storage/local-disk.driver';
import { VideoProcessingService } from '../video-processing/video-processing.service';

const SAMPLE_MEDIA_DIR = path.join(__dirname, '..', '..', '..', 'sample-media');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  console.log('🌱 Limpiando datos previos...');
  await db.delete(schema.auditLogs);
  await db.delete(schema.notifications);
  await db.delete(schema.shareLinks);
  await db.delete(schema.clips);
  await db.delete(schema.bookmarks);
  await db.delete(schema.events);
  await db.delete(schema.videoSegments);
  await db.delete(schema.videos);
  await db.delete(schema.matchPlayers);
  await db.delete(schema.teams);
  await db.delete(schema.matches);
  await db.delete(schema.cameras);
  await db.delete(schema.courts);
  await db.delete(schema.subscriptions);
  await db.delete(schema.complexes);
  await db.delete(schema.refreshTokens);
  await db.delete(schema.users);

  console.log('🏟️  Creando complejo "Deportivo San Martín"...');
  const [complex] = await db
    .insert(schema.complexes)
    .values({
      name: 'Deportivo San Martín',
      address: 'Av. Siempre Viva 1234, Buenos Aires',
      city: 'Buenos Aires',
      timezone: 'America/Argentina/Buenos_Aires',
      openingHours: { mon: ['08:00-23:59'], tue: ['08:00-23:59'], wed: ['08:00-23:59'], thu: ['08:00-23:59'], fri: ['08:00-23:59'], sat: ['08:00-23:59'], sun: ['08:00-23:59'] },
    })
    .returning();
  await db.insert(schema.subscriptions).values({ complexId: complex.id, plan: 'PRO', status: 'ACTIVE', cameraLimit: 20, retentionDays: 90 });

  const [court1] = await db.insert(schema.courts).values({ complexId: complex.id, name: 'Cancha 1', sportType: 'FUTBOL5', status: 'ACTIVE' }).returning();
  const [court2] = await db.insert(schema.courts).values({ complexId: complex.id, name: 'Cancha 2', sportType: 'PADEL', status: 'ACTIVE' }).returning();
  const [court3] = await db.insert(schema.courts).values({ complexId: complex.id, name: 'Cancha 3', sportType: 'FUTBOL5', status: 'ACTIVE' }).returning();

  await db.insert(schema.cameras).values([
    { courtId: court1.id, name: 'Cámara IP 01', type: 'IP_CAMERA', rtspUrl: 'rtsp://192.168.1.101:554/stream1', status: 'ONLINE', lastSeenAt: new Date() },
    { courtId: court2.id, name: 'Cámara IP 02', type: 'IP_CAMERA', rtspUrl: 'rtsp://192.168.1.102:554/stream1', status: 'ONLINE', lastSeenAt: new Date() },
    { courtId: court3.id, name: 'Cámara IP 03 (NVR canal 3)', type: 'NVR', nvrChannel: 3, status: 'OFFLINE', lastSeenAt: new Date(Date.now() - 1000 * 60 * 60 * 5) },
  ]);

  console.log('🏟️  Creando complejos adicionales (para probar el buscador por ciudad/deporte)...');
  const [complexCba] = await db
    .insert(schema.complexes)
    .values({
      name: 'Padel Club Nueva Córdoba',
      address: 'Bv. Illia 500, Córdoba',
      city: 'Córdoba',
      timezone: 'America/Argentina/Cordoba',
    })
    .returning();
  await db.insert(schema.subscriptions).values({ complexId: complexCba.id, plan: 'BASIC', status: 'ACTIVE', cameraLimit: 5, retentionDays: 30 });
  const [courtCbaPadel] = await db.insert(schema.courts).values({ complexId: complexCba.id, name: 'Cancha Norte', sportType: 'PADEL', status: 'ACTIVE' }).returning();
  const [courtCbaFutbol] = await db.insert(schema.courts).values({ complexId: complexCba.id, name: 'Cancha Sur', sportType: 'FUTBOL5', status: 'ACTIVE' }).returning();
  await db.insert(schema.cameras).values([
    { courtId: courtCbaPadel.id, name: 'Cámara IP 01', type: 'IP_CAMERA', rtspUrl: 'rtsp://192.168.2.101:554/stream1', status: 'ONLINE', lastSeenAt: new Date() },
    { courtId: courtCbaFutbol.id, name: 'Cámara IP 02', type: 'IP_CAMERA', rtspUrl: 'rtsp://192.168.2.102:554/stream1', status: 'ONLINE', lastSeenAt: new Date() },
  ]);

  const [complexRosario] = await db
    .insert(schema.complexes)
    .values({
      name: 'Fútbol Norte Rosario',
      address: 'Ovidio Lagos 2200, Rosario',
      city: 'Rosario',
      timezone: 'America/Argentina/Buenos_Aires',
    })
    .returning();
  await db.insert(schema.subscriptions).values({ complexId: complexRosario.id, plan: 'BASIC', status: 'ACTIVE', cameraLimit: 5, retentionDays: 30 });
  const [courtRosario] = await db.insert(schema.courts).values({ complexId: complexRosario.id, name: 'Cancha 1', sportType: 'FUTBOL5', status: 'ACTIVE' }).returning();
  await db.insert(schema.cameras).values([
    { courtId: courtRosario.id, name: 'Cámara IP 01', type: 'IP_CAMERA', rtspUrl: 'rtsp://192.168.3.101:554/stream1', status: 'ONLINE', lastSeenAt: new Date() },
  ]);

  // Un partido sin video todavía (SCHEDULED) en cada cancha nueva, así el buscador público
  // (deporte → ciudad → cancha → fecha) tiene algo para encontrar de entrada, incluyendo el
  // caso "grabación pendiente" (hasVideo: false).
  const cbaMatchStart = new Date();
  cbaMatchStart.setHours(20, 30, 0, 0);
  const [cbaMatch] = await db
    .insert(schema.matches)
    .values({
      complexId: complexCba.id,
      courtId: courtCbaPadel.id,
      sportType: 'PADEL',
      date: cbaMatchStart.toISOString().slice(0, 10),
      startTime: cbaMatchStart,
      status: 'SCHEDULED',
    })
    .returning();
  await db.insert(schema.teams).values([
    { matchId: cbaMatch.id, label: 'Pareja A' },
    { matchId: cbaMatch.id, label: 'Pareja B' },
  ]);

  const rosarioMatchStart = new Date();
  rosarioMatchStart.setHours(18, 0, 0, 0);
  const [rosarioMatch] = await db
    .insert(schema.matches)
    .values({
      complexId: complexRosario.id,
      courtId: courtRosario.id,
      sportType: 'FUTBOL5',
      date: rosarioMatchStart.toISOString().slice(0, 10),
      startTime: rosarioMatchStart,
      status: 'SCHEDULED',
    })
    .returning();
  await db.insert(schema.teams).values([
    { matchId: rosarioMatch.id, label: 'Equipo Verde' },
    { matchId: rosarioMatch.id, label: 'Equipo Blanco' },
  ]);

  console.log('👤 Creando usuarios...');
  const passwordHash = await bcrypt.hash('demo1234', 12);
  const [superAdmin] = await db
    .insert(schema.users)
    .values({ email: 'admin@liveplay.com', passwordHash, firstName: 'Admin', lastName: 'General', role: 'SUPER_ADMIN', emailVerifiedAt: new Date() })
    .returning();
  const [complexAdmin] = await db
    .insert(schema.users)
    .values({ email: 'complejo@liveplay.com', passwordHash, firstName: 'Gestor', lastName: 'San Martín', role: 'COMPLEX_ADMIN', managedComplexId: complex.id, emailVerifiedAt: new Date() })
    .returning();
  const [juan] = await db
    .insert(schema.users)
    .values({ email: 'juan@demo.com', passwordHash, firstName: 'Juan', lastName: 'Pérez', role: 'PLAYER', homeComplexId: complex.id, emailVerifiedAt: new Date() })
    .returning();
  const [pedro] = await db
    .insert(schema.users)
    .values({ email: 'pedro@demo.com', passwordHash, firstName: 'Pedro', lastName: 'Gómez', role: 'PLAYER', homeComplexId: complex.id, emailVerifiedAt: new Date() })
    .returning();
  const [lucas] = await db
    .insert(schema.users)
    .values({ email: 'lucas@demo.com', passwordHash, firstName: 'Lucas', lastName: 'Fernández', role: 'PLAYER', homeComplexId: complex.id, emailVerifiedAt: new Date() })
    .returning();

  console.log('⚽ Creando partido de Fútbol 5...');
  const matchStart = new Date();
  matchStart.setHours(21, 0, 0, 0);
  const matchDate = matchStart.toISOString().slice(0, 10);
  const [futbolMatch] = await db
    .insert(schema.matches)
    .values({
      complexId: complex.id,
      courtId: court1.id,
      sportType: 'FUTBOL5',
      date: matchDate,
      startTime: matchStart,
      status: 'SCHEDULED',
      resultSummary: { equipoAzul: 7, equipoRojo: 5 },
    })
    .returning();
  const [equipoAzul] = await db.insert(schema.teams).values({ matchId: futbolMatch.id, label: 'Equipo Azul', score: 7 }).returning();
  const [equipoRojo] = await db.insert(schema.teams).values({ matchId: futbolMatch.id, label: 'Equipo Rojo', score: 5 }).returning();
  await db.insert(schema.matchPlayers).values([
    { matchId: futbolMatch.id, userId: juan.id, teamId: equipoAzul.id },
    { matchId: futbolMatch.id, userId: pedro.id, teamId: equipoRojo.id },
    { matchId: futbolMatch.id, guestName: 'Invitado 1', teamId: equipoAzul.id },
    { matchId: futbolMatch.id, guestName: 'Invitado 2', teamId: equipoRojo.id },
  ]);
  await db.insert(schema.events).values([
    { matchId: futbolMatch.id, type: 'GOAL', timestampSeconds: 14, label: 'Gol de Juan', teamId: equipoAzul.id },
    { matchId: futbolMatch.id, type: 'GOAL', timestampSeconds: 32, label: 'Gol de Pedro', teamId: equipoRojo.id },
    { matchId: futbolMatch.id, type: 'YELLOW_CARD', timestampSeconds: 45, label: 'Tarjeta amarilla', teamId: equipoRojo.id },
    { matchId: futbolMatch.id, type: 'GREAT_SAVE', timestampSeconds: 61, label: 'Gran atajada' },
    { matchId: futbolMatch.id, type: 'GOAL', timestampSeconds: 78, label: 'Gol de Juan (doblete)', teamId: equipoAzul.id },
  ]);

  console.log('🎾 Creando partido de Pádel...');
  const padelStart = new Date();
  padelStart.setHours(19, 0, 0, 0);
  const [padelMatch] = await db
    .insert(schema.matches)
    .values({
      complexId: complex.id,
      courtId: court2.id,
      sportType: 'PADEL',
      date: padelStart.toISOString().slice(0, 10),
      startTime: padelStart,
      status: 'SCHEDULED',
      resultSummary: { sets: ['6-4', '4-6', '10-8'] },
    })
    .returning();
  const [parejaA] = await db.insert(schema.teams).values({ matchId: padelMatch.id, label: 'Pareja A', setsWon: 2 }).returning();
  const [parejaB] = await db.insert(schema.teams).values({ matchId: padelMatch.id, label: 'Pareja B', setsWon: 1 }).returning();
  await db.insert(schema.matchPlayers).values([
    { matchId: padelMatch.id, userId: juan.id, teamId: parejaA.id },
    { matchId: padelMatch.id, guestName: 'Pedro (invitado)', teamId: parejaA.id },
    { matchId: padelMatch.id, userId: lucas.id, teamId: parejaB.id },
    { matchId: padelMatch.id, guestName: 'Martín (invitado)', teamId: parejaB.id },
  ]);
  await db.insert(schema.events).values([
    { matchId: padelMatch.id, type: 'SET_POINT', timestampSeconds: 20, label: 'Fin del set 1 (6-4)' },
    { matchId: padelMatch.id, type: 'HIGHLIGHT', timestampSeconds: 40, label: 'Punto increíble en la red' },
  ]);

  console.log('🎬 Procesando video del partido de Fútbol 5 (FFmpeg -> HLS + thumbnails)...');
  const storageRoot = path.join(__dirname, '..', '..', '..', 'storage-data');
  const storageDriver = new LocalDiskStorageDriver(storageRoot, process.env.VIDEO_URL_SIGNING_SECRET ?? 'dev-video-signing-secret-change-me', process.env.API_PUBLIC_URL ?? 'http://localhost:3001');
  const ffmpeg = new FfmpegService();
  // Reutilizamos la misma lógica que el worker de la cola, pero llamada de forma síncrona/directa
  // para el seed (sin pasar por Redis) — ver VideoProcessingService.runProcessMatchVideoNow.
  const fakeQueue: any = { add: async () => undefined };
  const videoProcessing = new VideoProcessingService(fakeQueue, { db } as any, ffmpeg, storageDriver as any);

  const [futbolVideo] = await db
    .insert(schema.videos)
    .values({ matchId: futbolMatch.id, storageBaseKey: `complex-${complex.id}/court-${court1.id}/${matchDate.replace(/-/g, '/')}/21-00-00`, status: 'PENDING' })
    .returning();
  await videoProcessing.runProcessMatchVideoNow(futbolVideo.id, path.join(SAMPLE_MEDIA_DIR, 'match_futbol5_demo.mp4'));

  console.log('🎬 Procesando video del partido de Pádel (FFmpeg -> HLS + thumbnails)...');
  const [padelVideo] = await db
    .insert(schema.videos)
    .values({ matchId: padelMatch.id, storageBaseKey: `complex-${complex.id}/court-${court2.id}/${padelStart.toISOString().slice(0, 10).replace(/-/g, '/')}/19-00-00`, status: 'PENDING' })
    .returning();
  await videoProcessing.runProcessMatchVideoNow(padelVideo.id, path.join(SAMPLE_MEDIA_DIR, 'match_padel_demo.mp4'));

  console.log('\n✅ Seed completo.');
  console.log('\nUsuarios de prueba (contraseña para todos: demo1234):');
  console.log(`  SUPER_ADMIN   -> ${superAdmin.email}`);
  console.log(`  COMPLEX_ADMIN -> ${complexAdmin.email}`);
  console.log(`  PLAYER        -> ${juan.email} (jugó ambos partidos)`);
  console.log(`  PLAYER        -> ${pedro.email} (jugó el partido de fútbol)`);
  console.log(`  PLAYER        -> ${lucas.email} (jugó el partido de pádel)`);

  await pool.end();
}

main().catch((err) => {
  console.error('❌ Error en el seed:', err);
  process.exit(1);
});
