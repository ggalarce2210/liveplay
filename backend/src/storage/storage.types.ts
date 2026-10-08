/**
 * Contrato de almacenamiento. Toda la aplicación habla contra esta interfaz — nunca contra
 * rutas de disco o SDKs de un proveedor específico. Esto permite cambiar de "servidor local"
 * a S3 / MinIO / un NAS con backend S3, sin tocar el resto del sistema (requisito §26).
 *
 * `key` es siempre una ruta lógica relativa, ej:
 *   complex-01/court-03/2026/09/08/21-00-00/hls/master.m3u8
 * Nunca se expone esta key al frontend: todo se sirve mediante URLs firmadas de corta duración
 * (ver StorageService.getSignedReadUrl) para no exponer la estructura física (requisito §25/§10).
 */
export interface PutObjectInput {
  key: string;
  filePath?: string; // subir desde un archivo en disco
  body?: Buffer;
  contentType?: string;
}

export interface StorageDriver {
  putObject(input: PutObjectInput): Promise<void>;
  getObjectAsBuffer(key: string): Promise<Buffer>;
  getObjectStream(key: string): NodeJS.ReadableStream;
  getLocalPathForRead?(key: string): string | null; // optimización: streaming directo si el driver es local
  /**
   * Descarga un objeto a un archivo en disco usando streaming (nunca carga todo el objeto en
   * memoria, a diferencia de `getObjectAsBuffer`) — necesario para el video original de un
   * partido (cientos de MB a varios GB), donde bufferizar entero puede tirar abajo una instancia
   * con poca memoria (ver incidente 2026-10-08: pipeline de ingesta de video original).
   */
  downloadToFile(key: string, destPath: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getSignedReadUrl(key: string, expiresInSeconds: number): Promise<string>;
}
