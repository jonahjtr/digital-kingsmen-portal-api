import { describe, it, expect, afterEach } from 'vitest';
import {
  detectLogoFormat,
  normalizeLogoImage,
} from '../src/services/companyLogoNormalize';
import { setWorkerBindings } from '../src/lib/workerBindings';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const MINIMAL_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#336699"/></svg>',
  'utf8',
);

describe('detectLogoFormat', () => {
  it('detects PNG from magic bytes', () => {
    expect(detectLogoFormat(PNG_1X1)).toBe('png');
  });

  it('detects SVG from markup', () => {
    expect(detectLogoFormat(MINIMAL_SVG)).toBe('svg');
  });

  it('detects SVG from content-type header', () => {
    expect(detectLogoFormat(Buffer.from('not really svg'), 'image/svg+xml')).toBe('svg');
  });

  it('returns unknown for unrecognized bytes', () => {
    expect(detectLogoFormat(Buffer.from('hello'))).toBe('unknown');
  });
});

describe('normalizeLogoImage', () => {
  it('passes through a small PNG under the size cap', async () => {
    const result = await normalizeLogoImage(PNG_1X1, 'image/png');

    expect(result.mimeType).toBe('image/png');
    expect(result.fileName).toBe('logo.png');
    expect(result.size).toBe(result.buffer.length);
    expect(result.size).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it('does not require Cloudflare Images for small PNG (saves free transform quota)', async () => {
    const result = await normalizeLogoImage(PNG_1X1, 'image/png');
    expect(result.mimeType).toBe('image/png');
  });

  it('passes through AVIF when under the size cap (no IMAGES binding in tests)', async () => {
    const avif = Buffer.alloc(64, 0);
    avif.writeUInt32BE(0, 0);
    avif.write('ftyp', 4, 'ascii');
    avif.write('avif', 8, 'ascii');

    const result = await normalizeLogoImage(avif, 'image/avif');
    expect(result.mimeType).toBe('image/avif');
    expect(result.fileName).toBe('logo.avif');
  });

  it('stores a minimal SVG as SVG', async () => {
    const result = await normalizeLogoImage(MINIMAL_SVG, 'image/svg+xml');

    expect(result.mimeType).toBe('image/svg+xml');
    expect(result.fileName).toBe('logo.svg');
    expect(result.size).toBeGreaterThan(0);
    expect(result.size).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it('rejects empty input', async () => {
    await expect(normalizeLogoImage(Buffer.alloc(0))).rejects.toThrow(/empty file/i);
  });

  it('rejects unsupported format', async () => {
    await expect(normalizeLogoImage(Buffer.from('not-an-image'))).rejects.toThrow(
      /unsupported format/i,
    );
  });

  it('scales down oversized PNG dimensions via Cloudflare Images', async () => {
  /** Minimal PNG with IHDR claiming 3000×3000 (9M px) — triggers resize, not reject. */
    const hugePng = Buffer.from(PNG_1X1);
    hugePng.writeUInt32BE(3000, 16);
    hugePng.writeUInt32BE(3000, 20);

    const webpOut = Buffer.from(PNG_1X1);
    const mockImages = {
      input: () => ({
        transform: () => ({
          output: () => ({
            image: async () =>
              new Response(webpOut, { headers: { 'content-type': 'image/webp' } }),
          }),
        }),
      }),
    };

    setWorkerBindings({ IMAGES: mockImages as never });
    const result = await normalizeLogoImage(hugePng, 'image/png');
    expect(result.mimeType).toBe('image/webp');
    expect(result.fileName).toBe('logo.webp');
  });

  afterEach(() => {
    setWorkerBindings({});
  });
});
