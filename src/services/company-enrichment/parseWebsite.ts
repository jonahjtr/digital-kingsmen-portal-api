import type { ExtractedField, RawExtraction } from './types';
import { extractLogoField } from './logoExtraction';

const SCHEMA_TYPES = new Set([
  'LocalBusiness',
  'Organization',
  'Corporation',
  'HomeAndConstructionBusiness',
  'ProfessionalService',
  'Store',
  'Restaurant',
  'HVACBusiness',
  'Plumber',
  'Electrician',
  'RoofingContractor',
  'GeneralContractor',
]);

const INDUSTRY_LABELS: Record<string, string> = {
  LocalBusiness: 'Local business',
  Organization: 'Business',
  HomeAndConstructionBusiness: 'Home services',
  ProfessionalService: 'Professional services',
  HVACBusiness: 'HVAC',
  Plumber: 'Plumbing',
  Electrician: 'Electrical',
  RoofingContractor: 'Roofing',
  GeneralContractor: 'General contractor',
  Restaurant: 'Restaurant',
  Store: 'Retail',
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE =
  /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g;
const GMB_LINK_RE = /https?:\/\/(?:www\.)?google\.com\/maps\/[^\s"'<>]+/gi;

function field(value: string, confidence: ExtractedField['confidence']): ExtractedField {
  return { value: value.trim(), confidence };
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
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
  return decodeHtmlEntities(html.match(re)?.[1] ?? html.match(alt)?.[1] ?? '').trim() || undefined;
}

function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (!m) return undefined;
  const title = decodeHtmlEntities(m[1]).trim();
  return title.replace(/\s*[\|–-]\s*.+$/, '').trim() || title;
}

function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      blocks.push(parsed);
    } catch {
      /* skip invalid JSON-LD */
    }
  }
  return blocks;
}

function flattenJsonLd(node: unknown, out: Record<string, unknown>[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) flattenJsonLd(item, out);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (obj['@graph']) flattenJsonLd(obj['@graph'], out);
  out.push(obj);
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') flattenJsonLd(v, out);
  }
}

function schemaType(obj: Record<string, unknown>): string | undefined {
  const t = obj['@type'];
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) return t.find((x) => typeof x === 'string') as string | undefined;
  return undefined;
}

function isBusinessNode(obj: Record<string, unknown>): boolean {
  const t = schemaType(obj);
  if (!t) return false;
  return SCHEMA_TYPES.has(t) || t.includes('Business') || t.includes('Organization');
}

function readAddress(addr: unknown): Partial<RawExtraction> {
  if (!addr || typeof addr !== 'object') return {};
  const a = addr as Record<string, unknown>;
  const out: Partial<RawExtraction> = {};
  if (typeof a.streetAddress === 'string') out.address_line1 = field(a.streetAddress, 'high');
  if (typeof a.addressLocality === 'string') out.city = field(a.addressLocality, 'high');
  if (typeof a.addressRegion === 'string') out.state = field(a.addressRegion, 'high');
  if (typeof a.postalCode === 'string') out.postal_code = field(a.postalCode, 'high');
  if (typeof a.addressCountry === 'string') out.country = field(a.addressCountry, 'high');
  const parts = [
    a.streetAddress,
    a.addressLocality,
    a.addressRegion,
    a.postalCode,
    a.addressCountry,
  ].filter((x) => typeof x === 'string');
  if (parts.length) out.formatted_address = field(parts.join(', '), 'high');
  return out;
}

function fromJsonLd(html: string): Partial<RawExtraction> {
  const nodes: Record<string, unknown>[] = [];
  for (const block of extractJsonLdBlocks(html)) flattenJsonLd(block, nodes);

  const business = nodes.find(isBusinessNode) ?? nodes[0];
  if (!business) return {};

  const out: Partial<RawExtraction> = {};
  if (typeof business.name === 'string') out.name = field(business.name, 'high');
  if (typeof business.telephone === 'string') {
    out.main_contact_phone = field(String(business.telephone), 'high');
  }
  if (typeof business.email === 'string') {
    out.main_contact_email = field(String(business.email), 'high');
  }
  const t = schemaType(business);
  if (t) {
    const label = INDUSTRY_LABELS[t] ?? (t.includes('Business') ? 'Local business' : undefined);
    if (label) out.industry = field(label, 'medium');
  }
  if (typeof business.url === 'string') out.website = field(String(business.url), 'high');
  Object.assign(out, readAddress(business.address));

  return out;
}

function fromMetaAndTitle(html: string): Partial<RawExtraction> {
  const out: Partial<RawExtraction> = {};
  const ogName = extractMeta(html, 'og:site_name');
  const title = extractTitle(html);
  if (ogName) out.name = field(ogName, 'medium');
  else if (title) out.name = field(title, 'low');
  const desc = extractMeta(html, 'og:description') ?? extractMeta(html, 'description');
  if (desc && desc.length > 10 && desc.length < 200) {
    out.industry = field(desc.split('.')[0].slice(0, 80), 'low');
  }
  return out;
}

function fromLinks(html: string): Partial<RawExtraction> {
  const out: Partial<RawExtraction> = {};
  const mailto = html.match(/href=["']mailto:([^"'?]+)/i)?.[1];
  if (mailto) out.main_contact_email = field(decodeURIComponent(mailto), 'high');
  const tel = html.match(/href=["']tel:([^"']+)/i)?.[1];
  if (tel) out.main_contact_phone = field(decodeURIComponent(tel).replace(/\s+/g, ' '), 'high');
  const gmb = html.match(GMB_LINK_RE)?.[0];
  if (gmb) out.google_business_url = field(gmb, 'medium');
  return out;
}

function fromRegex(html: string): Partial<RawExtraction> {
  const out: Partial<RawExtraction> = {};
  const text = decodeHtmlEntities(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' '));
  const emails = [...new Set(text.match(EMAIL_RE) ?? [])].filter(
    (e) => !e.endsWith('.png') && !e.endsWith('.jpg') && !e.includes('example.com'),
  );
  if (emails[0] && !out.main_contact_email) {
    out.main_contact_email = field(emails[0], 'medium');
  }
  const phones = [...new Set(text.match(PHONE_RE) ?? [])].map((p) => p.trim());
  if (phones[0] && !out.main_contact_phone) {
    out.main_contact_phone = field(phones[0], 'medium');
  }
  return out;
}

export function parseWebsiteHtml(html: string, canonicalUrl: string): RawExtraction {
  const layers = [
    fromJsonLd(html),
    fromMetaAndTitle(html),
    fromLinks(html),
    fromRegex(html),
  ];
  const merged: RawExtraction = {};
  const keys = new Set<string>();
  for (const layer of layers) {
    for (const [key, val] of Object.entries(layer)) {
      if (!val || keys.has(key)) continue;
      keys.add(key);
      (merged as Record<string, ExtractedField>)[key] = val;
    }
  }
  if (!merged.website) merged.website = field(canonicalUrl, 'high');
  const logo = extractLogoField(html, canonicalUrl);
  if (logo) merged.suggested_logo_url = logo;
  return merged;
}
