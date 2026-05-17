import { StorageProvider, UploadMeta, StorageResult } from './types';

export class R2StorageProvider implements StorageProvider {
  constructor(private bucket: R2Bucket) {}

  async upload(buffer: Buffer, meta: UploadMeta): Promise<StorageResult> {
    const ext = meta.fileName.includes('.') ? meta.fileName.slice(meta.fileName.lastIndexOf('.')) : '';
    const key = `${Date.now()}-${crypto.randomUUID()}${ext}`;
    await this.bucket.put(key, buffer, {
      httpMetadata: { contentType: meta.mimeType },
    });
    return { url: key, key };
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  async get(key: string): Promise<{ body: ArrayBuffer; mimeType?: string } | null> {
    const object = await this.bucket.get(key);
    if (!object) return null;
    return {
      body: await object.arrayBuffer(),
      mimeType: object.httpMetadata?.contentType,
    };
  }
}
