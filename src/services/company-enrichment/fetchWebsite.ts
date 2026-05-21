import { normalizeWebsiteUrl } from './normalizeUrl';

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 10_000;
/** Browser-like UA — some hosts block obvious bots; we still detect challenge pages below. */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export interface FetchWebsiteResult {
  url: string;
  html: string;
  finalUrl: string;
}

export async function fetchWebsite(inputUrl: string): Promise<FetchWebsiteResult> {
  const url = normalizeWebsiteUrl(inputUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': USER_AGENT,
      },
    });
    if (!res.ok) {
      throw new Error(`Website returned HTTP ${res.status}`);
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      throw new Error('Website did not return HTML content');
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error('Empty response body');
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        throw new Error('Website response too large');
      }
      chunks.push(value);
    }
    const html = new TextDecoder('utf-8', { fatal: false }).decode(
      concatUint8(chunks, total),
    );
    return { url, html, finalUrl: res.url || url };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Website request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function concatUint8(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
