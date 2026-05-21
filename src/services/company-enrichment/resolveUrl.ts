import { normalizeWebsiteUrl } from './normalizeUrl';

/** Hostnames commonly used for logos/assets on builder-hosted sites (not the marketing domain). */
const LOGO_ASSET_HOST_PATTERNS = [
  /^images\.squarespace-cdn\.com$/i,
  /^static\d*\.squarespace\.com$/i,
  /^cdn\.shopify\.com$/i,
  /^i\d*\.wp\.com$/i,
  /^[^\s/]+\.cloudfront\.net$/i,
  /^[^\s/]+\.amazonaws\.com$/i,
];

export function resolveAbsoluteUrl(href: string, baseUrl: string): string | undefined {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('javascript:')) {
    return undefined;
  }
  try {
    const base = new URL(normalizeWebsiteUrl(baseUrl));
    const resolved = new URL(trimmed, base.toString());
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return undefined;
    return resolved.toString();
  } catch {
    return undefined;
  }
}

export function isLogoAssetHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOGO_ASSET_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

/** Resolve a logo/icon URL found on a company site (may be on a CDN host). */
export function resolveLogoCandidateUrl(href: string, baseUrl: string): string | undefined {
  return resolveAbsoluteUrl(href, baseUrl);
}

export function resolveSameHostUrl(href: string, baseUrl: string): string | undefined {
  const resolved = resolveAbsoluteUrl(href, baseUrl);
  if (!resolved) return undefined;
  try {
    const base = new URL(normalizeWebsiteUrl(baseUrl));
    const host = new URL(resolved).hostname.toLowerCase();
    if (host !== base.hostname.toLowerCase()) return undefined;
    return resolved;
  } catch {
    return undefined;
  }
}

export function assertLogoUrlAllowedForWebsite(logoUrl: string, companyWebsite: string): string {
  const resolved = resolveLogoCandidateUrl(logoUrl, companyWebsite);
  if (!resolved) {
    throw new Error('Logo URL is invalid');
  }
  try {
    const base = new URL(normalizeWebsiteUrl(companyWebsite));
    const host = new URL(resolved).hostname.toLowerCase();
    if (host === base.hostname.toLowerCase() || isLogoAssetHost(host)) {
      return resolved;
    }
  } catch {
    /* fall through */
  }
  throw new Error('Logo URL must be on the company website or an allowed image host');
}
