import { env } from '../config/env';
import { LocalStorageProvider } from './local.provider';
import { MemoryStorageProvider } from './memory.provider';
import { R2StorageProvider } from './r2.provider';
import { StorageProvider } from './types';

let storageProvider: StorageProvider | null = null;

export function initStorage(r2Bucket?: R2Bucket, options?: { useMemory?: boolean }): void {
  if (r2Bucket) {
    storageProvider = new R2StorageProvider(r2Bucket);
    return;
  }
  if (env.STORAGE_DRIVER === 'r2' || env.STORAGE_DRIVER === 's3') {
    throw new Error('R2 bucket binding required. Run with wrangler dev or set STORAGE_DRIVER=local');
  }
  if (options?.useMemory) {
    storageProvider = new MemoryStorageProvider();
    return;
  }
  storageProvider = new LocalStorageProvider();
}

export function getStorageProvider(): StorageProvider {
  if (!storageProvider) {
    initStorage();
  }
  return storageProvider!;
}
