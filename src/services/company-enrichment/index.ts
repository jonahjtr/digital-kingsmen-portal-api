import { BOT_CHALLENGE_WARNING, isBotChallengeHtml } from './botChallenge';
import { fetchWebsite } from './fetchWebsite';
import { normalizeOptionalUrl, normalizeWebsiteUrl } from './normalizeUrl';
import { parseWebsiteHtml } from './parseWebsite';
import { rawToPreview } from './mergeEnrichment';
import type { CompanyEnrichmentPreview } from './types';
import { checkEnrichRateLimit } from './rateLimit';
import {
  isEnrichmentCacheValid,
  loadCompanyEnrichmentRow,
  persistEnrichmentSnapshot,
  snapshotToPreview,
} from './enrichmentSnapshot';

export type { CompanyEnrichmentPreview, FieldConfidence } from './types';

export interface EnrichCompanyInput {
  website: string;
  google_business_url?: string;
  company_id?: string;
  force?: boolean;
  /** When false, scan results are not written to the company row until a later save. */
  persist?: boolean;
}

function finalizePreview(
  preview: CompanyEnrichmentPreview,
  website: string,
  google_business_url: string | undefined,
  baseWarnings: string[],
): CompanyEnrichmentPreview {
  preview.website = preview.website ?? website;
  if (google_business_url) {
    preview.google_business_url = google_business_url;
    preview.field_confidence.google_business_url = 'high';
  }
  if (preview.suggested_logo_url && preview.field_confidence.suggested_logo_url === 'low') {
    preview.warnings.push(
      'Suggested logo may be a social preview image — verify before using',
    );
  }
  const fieldCount = Object.keys(preview.field_confidence).length;
  if (fieldCount <= 1) {
    preview.warnings.push('Few details found on this website — please fill in manually');
  }
  preview.warnings = [...baseWarnings, ...preview.warnings];
  return preview;
}

export async function enrichCompanyFromWebsite(
  userId: string,
  input: EnrichCompanyInput,
): Promise<CompanyEnrichmentPreview> {
  checkEnrichRateLimit(userId);
  const warnings: string[] = [];
  const website = normalizeWebsiteUrl(input.website);
  let google_business_url: string | undefined;
  try {
    google_business_url = normalizeOptionalUrl(input.google_business_url);
  } catch {
    warnings.push('Google Business URL was invalid and ignored');
  }

  if (input.company_id && !input.force) {
    const row = await loadCompanyEnrichmentRow(input.company_id);
    if (
      row &&
      isEnrichmentCacheValid(row.lastEnrichmentWebsite, row.enrichedAt, website, false)
    ) {
      const cached = snapshotToPreview(row.enrichmentSnapshot);
      if (cached) {
        cached.warnings = [
          'Loaded cached website data — use Re-scan or change the URL to refresh',
          ...cached.warnings,
        ];
        return finalizePreview(cached, website, google_business_url, warnings);
      }
    }
  }

  try {
    const { html, finalUrl } = await fetchWebsite(website);
    if (isBotChallengeHtml(html)) {
      return {
        website,
        google_business_url,
        field_confidence: {
          website: 'high',
          ...(google_business_url ? { google_business_url: 'high' as const } : {}),
        },
        warnings: [BOT_CHALLENGE_WARNING, ...warnings],
      };
    }
    const raw = parseWebsiteHtml(html, finalUrl);
    const preview = finalizePreview(rawToPreview(raw, []), website, google_business_url, warnings);

    if (input.company_id && input.persist !== false) {
      await persistEnrichmentSnapshot(input.company_id, website, preview);
    }

    return preview;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not scan website';
    return {
      website,
      google_business_url,
      field_confidence: {
        website: 'high',
        ...(google_business_url ? { google_business_url: 'high' as const } : {}),
      },
      warnings: [message, ...warnings],
    };
  }
}
