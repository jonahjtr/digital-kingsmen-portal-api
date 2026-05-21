import { normalizeWebsiteUrl } from './normalizeUrl';
import type { CompanyEnrichmentPreview } from './types';

export const ENRICHMENT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function previewToSnapshot(preview: CompanyEnrichmentPreview): string {
  return JSON.stringify(preview);
}

export function snapshotToPreview(raw: string | null | undefined): CompanyEnrichmentPreview | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as CompanyEnrichmentPreview;
    if (!parsed.field_confidence || typeof parsed.field_confidence !== 'object') {
      parsed.field_confidence = {};
    }
    if (!Array.isArray(parsed.warnings)) {
      parsed.warnings = [];
    }
    return parsed;
  } catch {
    return null;
  }
}

export function isEnrichmentCacheValid(
  lastEnrichmentWebsite: string | null | undefined,
  lastEnrichmentAt: Date | null | undefined,
  website: string,
  force: boolean,
): boolean {
  if (force) return false;
  if (!lastEnrichmentWebsite || !lastEnrichmentAt) return false;
  try {
    const normalized = normalizeWebsiteUrl(website);
    const stored = normalizeWebsiteUrl(lastEnrichmentWebsite);
    if (normalized !== stored) return false;
    return Date.now() - lastEnrichmentAt.getTime() < ENRICHMENT_CACHE_TTL_MS;
  } catch {
    return false;
  }
}
