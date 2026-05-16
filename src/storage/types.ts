export interface UploadMeta {
  fileName: string;
  mimeType: string;
  size: number;
}

export interface StorageResult {
  url: string;
  key: string;
}

export interface StorageProvider {
  upload(buffer: Buffer, meta: UploadMeta): Promise<StorageResult>;
  delete(key: string): Promise<void>;
  getPath?(key: string): string;
}
