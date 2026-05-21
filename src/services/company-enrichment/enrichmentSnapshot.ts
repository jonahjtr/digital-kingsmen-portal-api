import { prisma } from '../../lib/prisma';
import { normalizeWebsiteUrl } from './normalizeUrl';
import type { CompanyEnrichmentPreview } from './types';
import { previewToSnapshot } from './enrichmentCache';

export { ENRICHMENT_CACHE_TTL_MS, previewToSnapshot, snapshotToPreview, isEnrichmentCacheValid } from './enrichmentCache';

export async function loadCompanyEnrichmentRow(companyId: string) {
  return prisma.company.findUnique({
    where: { id: companyId },
    select: {
      lastEnrichmentWebsite: true,
      enrichedAt: true,
      enrichmentSnapshot: true,
    },
  });
}

export async function persistEnrichmentSnapshot(
  companyId: string,
  website: string,
  preview: CompanyEnrichmentPreview,
): Promise<void> {
  const normalized = normalizeWebsiteUrl(website);
  const now = new Date();
  await prisma.company.update({
    where: { id: companyId },
    data: {
      lastEnrichmentWebsite: normalized,
      enrichedAt: now,
      enrichmentSnapshot: previewToSnapshot(preview),
      enrichmentSource: 'website',
    },
  });
}
