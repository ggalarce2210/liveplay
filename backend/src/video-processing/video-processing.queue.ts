export const VIDEO_PROCESSING_QUEUE = 'video-processing';

export type ProcessMatchVideoJob = {
  type: 'process-match-video';
  videoId: string;
  // Key en storage PERSISTENTE (R2/S3), nunca una ruta local de disco (ver incidente 2026-10-08:
  // antes esto era `sourceFilePath` apuntando a /tmp/ecp-uploads — un reinicio/recycle del
  // contenedor entre la subida y la ejecución del job (deploy, OOM, o simplemente el spin-down
  // por inactividad del free tier de Render) borraba ese archivo sin que el job (que sí persiste
  // en Redis) se enterara, y el video original se perdía para siempre tras agotar los reintentos.
  // Ahora `MatchesService.attachVideo` sube el archivo a storage persistente ANTES de encolar
  // (ver `VideoProcessingService.ingestSourceFile`), así que el worker puede descargarlo de ahí
  // sin importar cuántos reinicios pasaron en el medio.
  sourceStorageKey: string;
};

export type GenerateClipJob = {
  type: 'generate-clip';
  clipId: string;
};

export type VideoProcessingJobData = ProcessMatchVideoJob | GenerateClipJob;
