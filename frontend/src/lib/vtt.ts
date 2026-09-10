export interface ThumbnailCue {
  start: number;
  end: number;
  imageUrl: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function timeToSeconds(t: string): number {
  const parts = t.trim().split(':');
  let seconds = 0;
  if (parts.length === 3) {
    seconds += parseInt(parts[0], 10) * 3600;
    seconds += parseInt(parts[1], 10) * 60;
    seconds += parseFloat(parts[2]);
  } else if (parts.length === 2) {
    seconds += parseInt(parts[0], 10) * 60;
    seconds += parseFloat(parts[1]);
  }
  return seconds;
}

/** Parsea el WebVTT de miniaturas generado por FFmpeg (ver ffmpeg.service.ts) para el scrubber (§12/§33). */
export function parseThumbnailVtt(vttText: string): ThumbnailCue[] {
  const cues: ThumbnailCue[] = [];
  const blocks = vttText.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    const timeLine = lines.find((l) => l.includes('-->'));
    if (!timeLine) continue;
    const [startStr, endStr] = timeLine.split('-->').map((s) => s.trim());
    const imageLine = lines[lines.indexOf(timeLine) + 1];
    if (!imageLine) continue;
    const match = imageLine.match(/^(.*)#xywh=(\d+),(\d+),(\d+),(\d+)$/);
    if (!match) continue;
    const [, imageUrl, x, y, w, h] = match;
    cues.push({ start: timeToSeconds(startStr), end: timeToSeconds(endStr), imageUrl, x: Number(x), y: Number(y), w: Number(w), h: Number(h) });
  }
  return cues;
}

export function findCueAt(cues: ThumbnailCue[], time: number): ThumbnailCue | null {
  if (!cues.length) return null;
  // Búsqueda lineal: la cantidad de cues por partido es chica (uno cada ~5s); para partidos
  // de horas se podría indexar por bucket, ver ARCHITECTURE.md.
  for (const cue of cues) {
    if (time >= cue.start && time < cue.end) return cue;
  }
  return time < cues[0].start ? cues[0] : cues[cues.length - 1];
}
