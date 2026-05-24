import { normalizeWebsiteUrl } from './normalizeUrl';

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 10_000;

/** SiteGround and similar hosts often block browser UAs from datacenter IPs but allow simple fetchers. */
const SIMPLE_USER_AGENT = 'DigitalKingsmen-Enrichment/1.0 (+https://digitalkingsmen.com)';
const CURL_USER_AGENT = 'curl/8.6.0';
/** Browser-like UA — works on sites with bot protection that expect a real browser. */
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** Order matters: try simple agents before browser UA (SiteGround returns 403 for Chrome from Workers). */
const FETCH_USER_AGENTS = [SIMPLE_USER_AGENT, CURL_USER_AGENT, BROWSER_USER_AGENT];

/** HTTP statuses worth retrying with the next user agent. */
const RETRYABLE_HTTP_STATUSES = new Set([403, 503, 520, 521, 522, 523, 530]);

export interface FetchWebsiteResult {
  url: string;
  html: string;
  finalUrl: string;
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function friendlyHttpError(status: number, url: string): string {
  const host = hostFromUrl(url);
  if (RETRYABLE_HTTP_STATUSES.has(status)) {
    return `Could not reach ${host} — the site may block automated scans (HTTP ${status})`;
  }
  if (status === 404) {
    return `Website not found at ${host} (HTTP 404)`;
  }
  return `Website returned HTTP ${status}`;
}

function fetchPage(url: string, signal: AbortSignal, userAgent: string): Promise<Response> {
  return fetch(url, {
    signal,
    redirect: 'follow',
    headers: {
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': userAgent,
    },
  });
}

export async function fetchWebsite(inputUrl: string): Promise<FetchWebsiteResult> {
  const url = normalizeWebsiteUrl(inputUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let res: Response | null = null;
    for (let i = 0; i < FETCH_USER_AGENTS.length; i++) {
      res = await fetchPage(url, controller.signal, FETCH_USER_AGENTS[i]!);
      if (res.ok) break;
      const canRetry =
        RETRYABLE_HTTP_STATUSES.has(res.status) && i < FETCH_USER_AGENTS.length - 1;
      if (!canRetry) {
        throw new Error(friendlyHttpError(res.status, url));
      }
    }
    if (!res?.ok) {
      throw new Error(friendlyHttpError(res.status, url));
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
    if (err instanceof TypeError) {
      throw new Error(
        `Could not reach ${hostFromUrl(url)} — check the URL for typos`,
      );
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
