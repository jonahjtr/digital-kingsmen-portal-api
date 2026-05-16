import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { env } from '../config/env';
import { StorageProvider, UploadMeta, StorageResult } from './types';

export class LocalStorageProvider implements StorageProvider {
  private baseDir: string;

  constructor() {
    this.baseDir = path.resolve(env.UPLOAD_DIR);
  }

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  async upload(buffer: Buffer, meta: UploadMeta): Promise<StorageResult> {
    await this.ensureDir();
    const ext = path.extname(meta.fileName) || '';
    const key = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    const fullPath = path.join(this.baseDir, key);
    await fs.writeFile(fullPath, buffer);
    return { url: key, key };
  }

  async delete(key: string): Promise<void> {
    const fullPath = path.join(this.baseDir, key);
    try {
      await fs.unlink(fullPath);
    } catch {
      // ignore missing files
    }
  }

  getPath(key: string): string {
    return path.join(this.baseDir, key);
  }
}
