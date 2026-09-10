export const VIDEO_PROCESSING_QUEUE = 'video-processing';

export type ProcessMatchVideoJob = {
  type: 'process-match-video';
  videoId: string;
  sourceFilePath: string; // archivo fuente (subido por la cámara/NVR o cargado manualmente)
};

export type GenerateClipJob = {
  type: 'generate-clip';
  clipId: string;
};

export type VideoProcessingJobData = ProcessMatchVideoJob | GenerateClipJob;
