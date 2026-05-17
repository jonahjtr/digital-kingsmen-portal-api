export interface UploadMeta {
  fileName: string;
  mimeType: string;
  size: number;
}

export interface StorageResult {
  url: string;
  key: string;
}

export interface StorageObject {
  body: ArrayBuffer;
  mimeType?: string;
}

export interface StorageProvider {
  upload(buffer: Buffer, meta: UploadMeta): Promise<StorageResult>;
  delete(key: string): Promise<void>;
  get?(key: string): Promise<StorageObject | null>;
}
