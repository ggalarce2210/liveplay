import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as jwt from 'jsonwebtoken';
import { StorageDriver, PutObjectInput } from './storage.types';

/**
 * Driver "servidor local / NAS": guarda los objetos en disco, respetando el mismo layout
 * de keys que usaría un bucket S3 (§10). Es el driver activo en esta demo.
 *
 * Las URLs firmadas no son URLs S3 reales: son un JWT de corta duración con la key embebida,
 * validado por VideoStreamGuard antes de servir el archivo (§25 — no exponer rutas físicas,
 * expiración de enlaces).
 */
export class LocalDiskStorageDriver implements StorageDriver {
  constructor(private readonly rootDir: string, private readonly signingSecret: string, private readonly publicBaseUrl: string) {
    fs.mkdirSync(rootDir, { recursive: true });
  }

  private resolve(key: string): string {
    const safe = path.normalize(key).replace(/^(\.\.[/\\])+/, '');
    return path.join(this.rootDir, safe);
  }

  async putObject({ key, filePath, body }: PutObjectInput): Promise<void> {
    const dest = this.resolve(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    if (filePath) {
      await fsp.copyFile(filePath, dest);
    } else if (body) {
      await fsp.writeFile(dest, body);
    } else {
      throw new Error('putObject requiere filePath o body');
    }
  }

  async getObjectAsBuffer(key: string): Promise<Buffer> {
    return fsp.readFile(this.resolve(key));
  }

  getObjectStream(key: string): NodeJS.ReadableStream {
    return fs.createReadStream(this.resolve(key));
  }

  getLocalPathForRead(key: string): string | null {
    return this.resolve(key);
  }

  async downloadToFile(key: string, destPath: string): Promise<void> {
    await fsp.mkdir(path.dirname(destPath), { recursive: true });
    await fsp.copyFile(this.resolve(key), destPath);
  }

  async deleteObject(key: string): Promise<void> {
    await fsp.rm(this.resolve(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    await fsp.rm(this.resolve(prefix), { recursive: true, force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fsp.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async getSignedReadUrl(key: string, expiresInSeconds: number): Promise<string> {
    const token = jwt.sign({ key }, this.signingSecret, { expiresIn: expiresInSeconds });
    return `${this.publicBaseUrl}/api/stream/${encodeURIComponent(token)}`;
  }
}
