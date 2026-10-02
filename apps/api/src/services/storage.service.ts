import { Client } from 'minio';
import { getConfig } from '@cloudvault/config';

export interface StoredObjectMetadata { size: number; etag?: string; contentType?: string }

export interface StorageProvider {
  upload(key: string, data: Buffer, metadata: Record<string, string>): Promise<void>;
  download(key: string): Promise<NodeJS.ReadableStream>;
  delete(key: string): Promise<void>;
  copy(sourceKey: string, destinationKey: string): Promise<void>;
  getMetadata(key: string): Promise<StoredObjectMetadata>;
  createTemporaryDownloadUrl(key: string, expiresInSeconds: number, responseHeaders?: Record<string, string>): Promise<string>;
  ready(): Promise<boolean>;
}

const config = getConfig();

export class MinioStorageProvider implements StorageProvider {
  private readonly client = new Client({
    endPoint: config.MINIO_ENDPOINT,
    port: config.MINIO_PORT,
    useSSL: config.MINIO_USE_SSL,
    accessKey: config.MINIO_ACCESS_KEY,
    secretKey: config.MINIO_SECRET_KEY
  });

  async ensureBucket(): Promise<void> {
    if (!(await this.client.bucketExists(config.MINIO_BUCKET))) await this.client.makeBucket(config.MINIO_BUCKET);
  }

  async upload(key: string, data: Buffer, metadata: Record<string, string>): Promise<void> {
    await this.client.putObject(config.MINIO_BUCKET, key, data, data.length, { ...metadata, 'x-amz-server-side-encryption': 'AES256' });
  }

  async download(key: string): Promise<NodeJS.ReadableStream> { return this.client.getObject(config.MINIO_BUCKET, key); }
  async delete(key: string): Promise<void> { await this.client.removeObject(config.MINIO_BUCKET, key); }
  async copy(sourceKey: string, destinationKey: string): Promise<void> { await this.client.copyObject(config.MINIO_BUCKET, destinationKey, `/${config.MINIO_BUCKET}/${sourceKey}`); }

  async getMetadata(key: string): Promise<StoredObjectMetadata> {
    const stat = await this.client.statObject(config.MINIO_BUCKET, key);
    return { size: stat.size, etag: stat.etag, contentType: stat.metaData?.['content-type'] as string | undefined };
  }

  async createTemporaryDownloadUrl(key: string, expiresInSeconds: number, responseHeaders: Record<string, string> = {}): Promise<string> {
    return this.client.presignedGetObject(config.MINIO_BUCKET, key, expiresInSeconds, responseHeaders);
  }

  async ready(): Promise<boolean> {
    try { return await this.client.bucketExists(config.MINIO_BUCKET); } catch { return false; }
  }
}

export const storage = new MinioStorageProvider();
