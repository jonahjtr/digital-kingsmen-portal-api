/** Heuristics for CDN / host bot-check pages (Cloudflare, Vercel, etc.). */
export function isBotChallengeHtml(html: string): boolean {
  if (!html || html.length < 50) return false;

  const sample = html.slice(0, 80_000);
  const lower = sample.toLowerCase();
  const title = extractTitle(sample)?.toLowerCase() ?? '';

  const titleSignals = [
    'checking your browser',
    'just a moment',
    'attention required',
    'please wait',
    'security check',
    'ddos protection',
  ];
  if (titleSignals.some((s) => title.includes(s))) return true;

  const bodySignals = [
    'checking your browser',
    'enable javascript and cookies',
    'cf-browser-verification',
    'challenge-platform',
    'cf-challenge',
    'vercel security checkpoint',
    '/.well-known/vercel/security',
    'bot management',
    'ray id',
    'performance & security by cloudflare',
  ];
  const hits = bodySignals.filter((s) => lower.includes(s)).length;
  if (hits >= 2) return true;
  if (lower.includes('checking your browser')) return true;
  if (lower.includes('cf-chl') || lower.includes('__cf_chl')) return true;

  return false;
}

function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m?.[1]?.trim();
}

export const BOT_CHALLENGE_WARNING =
  'This website blocks automated scans (browser security). Enter company details manually, or try again later.';
