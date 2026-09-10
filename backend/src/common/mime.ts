const TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/MP2T',
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.vtt': 'text/vtt',
};

export function lookup(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return TYPES[ext] ?? 'application/octet-stream';
}
