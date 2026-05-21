import type { ExtractedField } from './types';
import { resolveLogoCandidateUrl } from './resolveUrl';

function field(value: string, confidence: ExtractedField['confidence']): ExtractedField {
  return { value: value.trim(), confidence };
}

function extractMeta(html: string, property: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    'i',
  );
  const alt = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    'i',
  );
  const raw = html.match(re)?.[1] ?? html.match(alt)?.[1] ?? '';
  return raw.trim() || undefined;
}

function extractLinkRelHrefs(html: string, rel: string): string[] {
  const hrefs: string[] = [];
  const linkRe = /<link[^>]+>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html))) {
    const tag = m[0];
    const relMatch = tag.match(/\brel=["']([^"']+)["']/i);
    if (!relMatch) continue;
    const rels = relMatch[1].toLowerCase().split(/\s+/);
    if (!rels.includes(rel.toLowerCase())) continue;
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (href) hrefs.push(href);
  }
  return hrefs;
}

function urlFormatScore(url: string): number {
  const lower = url.toLowerCase();
  if (lower.includes('logo')) return 6;
  if (lower.includes('.svg')) return 5;
  if (lower.includes('.png')) return 4;
  if (lower.includes('.webp')) return 4;
  if (lower.includes('.jpg') || lower.includes('.jpeg')) return 3;
  if (lower.includes('.gif')) return 2;
  if (lower.includes('.avif')) return 1;
  if (lower.includes('.ico')) return 0;
  return 1;
}

function pickBestIcon(urls: string[]): string | undefined {
  if (!urls.length) return undefined;
  return [...urls].sort((a, b) => urlFormatScore(b) - urlFormatScore(a))[0];
}

const CONFIDENCE_RANK: Record<ExtractedField['confidence'], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function imageUrlFromJsonLdValue(image: unknown): string | undefined {
  if (typeof image === 'string' && image.trim()) return image.trim();
  if (image && typeof image === 'object') {
    const img = image as Record<string, unknown>;
    if (typeof img.url === 'string' && img.url.trim()) return img.url.trim();
    if (typeof img.contentUrl === 'string' && img.contentUrl.trim()) return img.contentUrl.trim();
  }
  return undefined;
}

function readJsonLdLogo(html: string): string | undefined {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const url = findLogoInNode(parsed);
      if (url) return url;
    } catch {
      /* skip */
    }
  }
  return undefined;
}

function findLogoInNode(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findLogoInNode(item);
      if (found) return found;
    }
    return undefined;
  }
  const obj = node as Record<string, unknown>;
  if (obj['@graph']) {
    const fromGraph = findLogoInNode(obj['@graph']);
    if (fromGraph) return fromGraph;
  }
  const logo = obj.logo;
  if (typeof logo === 'string' && logo.trim()) return logo.trim();
  const fromLogoObj = imageUrlFromJsonLdValue(logo);
  if (fromLogoObj) return fromLogoObj;

  const image = imageUrlFromJsonLdValue(obj.image);
  if (image) return image;

  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const found = findLogoInNode(v);
      if (found) return found;
    }
  }
  return undefined;
}

function imgSrcFromTag(tag: string): string | undefined {
  return (
    tag.match(/\bsrc=["']([^"']+)["']/i)?.[1] ??
    tag.match(/\bdata-src=["']([^"']+)["']/i)?.[1] ??
    tag.match(/\bdata-image=["']([^"']+)["']/i)?.[1]
  );
}

function tagLooksLikeLogo(tag: string): boolean {
  const blob = tag.toLowerCase();
  return (
    blob.includes('logo') ||
    blob.includes('site-logo') ||
    blob.includes('header-logo') ||
    blob.includes('brand-logo') ||
    blob.includes('navbar-brand')
  );
}

function extractHeaderLogoImg(html: string): string | undefined {
  const regions = [
    html.match(/<header[\s\S]*?<\/header>/i)?.[0],
    html.match(/<nav[\s\S]*?<\/nav>/i)?.[0],
    html.slice(0, 100_000),
  ].filter(Boolean) as string[];

  for (const region of regions) {
    const imgRe = /<img[^>]+>/gi;
    let m: RegExpExecArray | null;
    while ((m = imgRe.exec(region))) {
      const tag = m[0];
      if (!tagLooksLikeLogo(tag)) continue;
      const src = imgSrcFromTag(tag);
      if (src) return src;
    }
  }
  return undefined;
}

function pushCandidate(
  candidates: Array<{ url: string; confidence: ExtractedField['confidence'] }>,
  href: string | undefined,
  baseUrl: string,
  confidence: ExtractedField['confidence'],
): void {
  if (!href) return;
  const resolved = resolveLogoCandidateUrl(href, baseUrl);
  if (resolved) candidates.push({ url: resolved, confidence });
}

export function extractLogoField(html: string, baseUrl: string): ExtractedField | undefined {
  const candidates: Array<{ url: string; confidence: ExtractedField['confidence'] }> = [];

  pushCandidate(candidates, readJsonLdLogo(html), baseUrl, 'high');

  for (const href of extractLinkRelHrefs(html, 'apple-touch-icon')) {
    pushCandidate(candidates, href, baseUrl, 'medium');
  }

  const icons = extractLinkRelHrefs(html, 'icon').concat(
    extractLinkRelHrefs(html, 'shortcut icon'),
  );
  pushCandidate(candidates, pickBestIcon(icons), baseUrl, 'medium');

  pushCandidate(candidates, extractHeaderLogoImg(html), baseUrl, 'high');

  pushCandidate(candidates, extractMeta(html, 'og:image'), baseUrl, 'low');

  if (!candidates.length) return undefined;

  const best = candidates.sort((a, b) => {
    const byConfidence = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
    if (byConfidence !== 0) return byConfidence;
    return urlFormatScore(b.url) - urlFormatScore(a.url);
  })[0];

  return field(best.url, best.confidence);
}
