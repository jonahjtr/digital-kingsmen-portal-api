const WINDOW_MS = 60_000;
const MAX_REQUESTS = 10;
const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkEnrichRateLimit(userId: string): void {
  const now = Date.now();
  let bucket = buckets.get(userId);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(userId, bucket);
  }
  bucket.count += 1;
  if (bucket.count > MAX_REQUESTS) {
    throw new Error('Too many enrichment requests. Please wait a minute and try again.');
  }
}
