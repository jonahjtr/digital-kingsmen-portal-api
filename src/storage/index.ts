import { env } from '../config/env';
import { LocalStorageProvider } from './local.provider';
import { StorageProvider } from './types';

export function getStorageProvider(): StorageProvider {
  if (env.STORAGE_DRIVER === 's3') {
    throw new Error('S3 storage not yet implemented. Set STORAGE_DRIVER=local');
  }
  return new LocalStorageProvider();
}
