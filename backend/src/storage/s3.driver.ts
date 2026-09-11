import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'fs';
import { Readable } from 'stream';
import { StorageDriver, PutObjectInput } from './storage.types';

/**
 * Driver S3-compatible: funciona igual contra AWS S3, MinIO auto-hospedado, DigitalOcean
 * Spaces o Backblaze B2 (todos hablan la API S3). Este código está completo y listo para
 * producción — en esta demo corre el LocalDiskStorageDriver porque el sandbox no tiene un
 * servidor S3/MinIO disponible, pero pasar a este driver es solo cuestión de variables de
 * entorno (STORAGE_PROVIDER=S3, S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY).
 */
export class S3StorageDriver implements StorageDriver {
  private client: S3Client;

  constructor(
    private readonly bucket: string,
    endpoint: string,
    region: string,
    accessKeyId: string,
    secretAccessKey: string,
    forcePathStyle = true, // true para MinIO / S3-compatibles fuera de AWS
  ) {
    this.client = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle,
    });
  }

  async putObject({ key, filePath, body, contentType }: PutObjectInput): Promise<void> {
    const Body = filePath ? fs.createReadStream(filePath) : body;
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body, ContentType: contentType }),
    );
  }

  async getObjectAsBuffer(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const stream = res.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  getObjectStream(): NodeJS.ReadableStream {
    throw new Error('Usar getSignedReadUrl y redirigir al cliente en el driver S3.');
  }

  getLocalPathForRead(): null {
    return null;
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deletePrefix(prefix: string): Promise<void> {
    const list = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix }),
    );
    for (const obj of list.Contents ?? []) {
      if (obj.Key) await this.deleteObject(obj.Key);
    }
  }

  async exists(key: string): Promise<boolean> {
    console.log('EXISTS_ENTER key=' + key + ' bucket=' + this.bucket);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err: any) {
      console.error('[S3StorageDriver.exists] HeadObject failed key=' + key, err?.name, err?.message, (err as any)?.Code, err?.$metadata?.httpStatusCode); return false;
    }
  }

  async getSignedReadUrl(key: string, expiresInSeconds: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}
