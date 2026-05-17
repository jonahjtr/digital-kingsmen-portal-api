import crypto from 'crypto';
import path from 'path';
import { StorageProvider, UploadMeta, StorageResult } from './types';

/** Ephemeral uploads for Workers when R2 is not bound (dev only). */
export class MemoryStorageProvider implements StorageProvider {
  private readonly objects = new Map<string, { body: Buffer; mimeType: string }>();

  async upload(buffer: Buffer, meta: UploadMeta): Promise<StorageResult> {
    const ext = path.extname(meta.fileName) || '';
    const key = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    this.objects.set(key, { body: buffer, mimeType: meta.mimeType });
    return { url: key, key };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async get(key: string): Promise<{ body: ArrayBuffer; mimeType?: string } | null> {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      body: object.body.buffer.slice(
        object.body.byteOffset,
        object.body.byteOffset + object.body.byteLength,
      ),
      mimeType: object.mimeType,
    };
  }
}
