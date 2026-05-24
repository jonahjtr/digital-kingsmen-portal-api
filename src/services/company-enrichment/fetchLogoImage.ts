import { assertLogoUrlAllowedForWebsite } from './resolveUrl';
import {
  detectLogoFormat,
  MAX_SOURCE_LOGO_BYTES,
  normalizeLogoImage,
} from '../companyLogoNormalize';
const TIMEOUT_MS = 10_000;
const USER_AGENT = 'DigitalKingsmenPortalBot/1.0 (+company-enrichment)';

/** Prefer raster formats CDNs often serve without AVIF negotiation. */
const PREFERRED_ACCEPT =
  'image/png,image/jpeg,image/webp,image/svg+xml,image/gif,image/*;q=0.8';
const AVIF_FALLBACK_ACCEPT = 'image/png,image/jpeg,image/webp,image/*;q=0.9';

export interface FetchedLogoImage {
  buffer: Buffer;
  mimeType: string;
  size: number;
  fileName: string;
}

async function downloadLogoBytes(
  url: string,
  accept: string,
  signal: AbortSignal,
): Promise<{ buffer: Buffer; contentType: string | null }> {
  const res = await fetch(url, {
    signal,
    redirect: 'follow',
    headers: {
      Accept: accept,
      'User-Agent': USER_AGENT,
    },
  });
  if (!res.ok) {
    throw new Error(`Logo URL returned HTTP ${res.status}`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error('Empty logo response');
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SOURCE_LOGO_BYTES) {
      throw new Error('Logo image is too large (max 12MB)');
    }
    chunks.push(value);
  }
  return {
    buffer: Buffer.concat(chunks.map((c) => Buffer.from(c))),
    contentType: res.headers.get('content-type'),
  };
}

export async function fetchLogoImage(
  logoUrl: string,
  companyWebsite: string,
): Promise<FetchedLogoImage> {
  const url = assertLogoUrlAllowedForWebsite(logoUrl, companyWebsite);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let { buffer, contentType } = await downloadLogoBytes(url, PREFERRED_ACCEPT, controller.signal);

    let format = detectLogoFormat(buffer, contentType);
    if (format === 'avif') {
      try {
        const retry = await downloadLogoBytes(url, AVIF_FALLBACK_ACCEPT, controller.signal);
        const retryFormat = detectLogoFormat(retry.buffer, retry.contentType);
        if (retryFormat !== 'avif') {
          buffer = retry.buffer;
          contentType = retry.contentType;
          format = retryFormat;
        }
      } catch {
        /* keep AVIF response; pass-through below */
      }
    }

    const normalized = await normalizeLogoImage(buffer, contentType);
    return {
      buffer: normalized.buffer,
      mimeType: normalized.mimeType,
      size: normalized.size,
      fileName: normalized.fileName,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Logo download timed out');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
