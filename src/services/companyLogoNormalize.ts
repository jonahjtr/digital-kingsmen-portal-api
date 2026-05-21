import { getWorkerBindings } from '../lib/workerBindings';

/** Max stored logo size (matches upload / fetch cap). */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export const OUTPUT_LOGO_MIME = 'image/webp' as const;
export const OUTPUT_LOGO_FILE = 'logo.webp' as const;

const MAX_OUTPUT_BYTES = MAX_LOGO_BYTES;
const MAX_PIXELS = 4_000_000;
const MAX_LOGO_EDGE = 512;
const WEBP_QUALITY = 80;
/** Only use Cloudflare Images (counts toward free tier) when conversion helps. */
const TRANSFORM_SIZE_THRESHOLD = 400 * 1024;

export type LogoFormat =
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'gif'
  | 'svg'
  | 'ico'
  | 'avif'
  | 'unknown';

export interface NormalizedLogo {
  buffer: Buffer;
  mimeType: string;
  size: number;
  fileName: string;
}

function normalizeContentType(contentType?: string | null): string | undefined {
  if (!contentType) return undefined;
  return contentType.split(';')[0].trim().toLowerCase();
}

function sniffRasterMime(buffer: Buffer): LogoFormat | undefined {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  if (
    buffer.length >= 6 &&
    (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a')
  ) {
    return 'gif';
  }
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === '\x00\x00\x01\x00') {
    return 'ico';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 4, 8) === 'ftyp' &&
    (buffer.toString('ascii', 8, 12).includes('avif') ||
      buffer.toString('ascii', 8, 12).includes('avis'))
  ) {
    return 'avif';
  }
  return undefined;
}

function sniffSvg(buffer: Buffer): boolean {
  const head = buffer
    .subarray(0, Math.min(buffer.length, 4096))
    .toString('utf8')
    .trimStart()
    .toLowerCase();
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'));
}

export function detectLogoFormat(buffer: Buffer, contentType?: string | null): LogoFormat {
  const headerMime = normalizeContentType(contentType);
  if (headerMime === 'image/svg+xml' || headerMime?.includes('svg')) return 'svg';
  if (headerMime === 'image/x-icon' || headerMime === 'image/vnd.microsoft.icon') return 'ico';
  if (headerMime === 'image/avif') return 'avif';

  if (sniffSvg(buffer)) return 'svg';
  const sniffed = sniffRasterMime(buffer);
  if (sniffed) return sniffed;

  if (headerMime === 'image/jpeg') return 'jpeg';
  if (headerMime === 'image/png') return 'png';
  if (headerMime === 'image/webp') return 'webp';
  if (headerMime === 'image/gif') return 'gif';

  return 'unknown';
}

function mimeForFormat(format: LogoFormat): string {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    case 'avif':
      return 'image/avif';
    default:
      return 'application/octet-stream';
  }
}

function fileNameForMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'logo.jpg';
    case 'image/png':
      return 'logo.png';
    case 'image/webp':
      return OUTPUT_LOGO_FILE;
    case 'image/gif':
      return 'logo.gif';
    case 'image/svg+xml':
      return 'logo.svg';
    case 'image/avif':
      return 'logo.avif';
    default:
      return 'logo.bin';
  }
}

function extractEmbeddedRasterFromIco(buffer: Buffer): Buffer | null {
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const pngIdx = buffer.indexOf(pngSig);
  if (pngIdx >= 0) return buffer.subarray(pngIdx);

  const jpegSig = Buffer.from([0xff, 0xd8, 0xff]);
  const jpegIdx = buffer.indexOf(jpegSig);
  if (jpegIdx >= 0) return buffer.subarray(jpegIdx);

  return null;
}

function estimatePixelCount(buffer: Buffer, format: LogoFormat): number | undefined {
  if (format === 'png' && buffer.length >= 24) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width > 0 && height > 0) return width * height;
  }
  return undefined;
}

function prepareLogoBytes(buffer: Buffer, format: LogoFormat): { buffer: Buffer; format: LogoFormat } {
  if (format === 'svg' || sniffSvg(buffer)) {
    return { buffer, format: 'svg' };
  }

  if (format === 'ico') {
    const embedded = extractEmbeddedRasterFromIco(buffer);
    if (!embedded) {
      throw new Error('Could not process ICO logo (no embedded PNG or JPEG found)');
    }
    const embeddedFormat = sniffRasterMime(embedded) ?? 'png';
    return { buffer: embedded, format: embeddedFormat };
  }

  if (format === 'unknown') {
    throw new Error('Could not process logo image (unsupported format)');
  }

  return { buffer, format };
}

function shouldUseImagesTransform(format: LogoFormat, byteLength: number): boolean {
  if (format === 'svg') return false;
  if (format === 'avif' || format === 'gif') return true;
  if (byteLength > TRANSFORM_SIZE_THRESHOLD) return true;
  return false;
}

function bufferToStream(buffer: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });
}

async function transformWithCloudflareImages(
  images: ImagesBinding,
  buffer: Buffer,
): Promise<NormalizedLogo> {
  const result = await images
    .input(bufferToStream(buffer))
    .transform({ width: MAX_LOGO_EDGE, fit: 'scale-down' })
    .output({ format: 'image/webp', quality: WEBP_QUALITY, anim: false });

  const out = Buffer.from(await new Response(result.image()).arrayBuffer());
  if (!out.length) {
    throw new Error('Could not process logo image (empty transform result)');
  }
  if (out.length > MAX_OUTPUT_BYTES) {
    throw new Error('Logo image is too large (max 2MB)');
  }

  return {
    buffer: out,
    mimeType: OUTPUT_LOGO_MIME,
    size: out.length,
    fileName: OUTPUT_LOGO_FILE,
  };
}

function passThroughLogo(buffer: Buffer, format: LogoFormat): NormalizedLogo {
  const mimeType = mimeForFormat(format);
  return {
    buffer,
    mimeType,
    size: buffer.length,
    fileName: fileNameForMime(mimeType),
  };
}

export async function normalizeLogoImage(
  buffer: Buffer,
  contentType?: string | null,
): Promise<NormalizedLogo> {
  if (!buffer.length) {
    throw new Error('Could not process logo image (empty file)');
  }

  const detectedFormat = detectLogoFormat(buffer, contentType);
  const { buffer: rasterBuffer, format } = prepareLogoBytes(buffer, detectedFormat);

  const pixels = estimatePixelCount(rasterBuffer, format);
  if (pixels !== undefined && pixels > MAX_PIXELS) {
    throw new Error('Logo image is too large to process');
  }

  if (rasterBuffer.length > MAX_OUTPUT_BYTES) {
    throw new Error('Logo image is too large (max 2MB)');
  }

  const images = getWorkerBindings()?.IMAGES;
  if (images && shouldUseImagesTransform(format, rasterBuffer.length)) {
    try {
      return await transformWithCloudflareImages(images, rasterBuffer);
    } catch {
      /* fall through to pass-through */
    }
  }

  return passThroughLogo(rasterBuffer, format);
}
