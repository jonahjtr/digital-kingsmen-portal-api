import { describe, expect, it } from 'vitest';
import {
  isEnrichmentCacheValid,
  previewToSnapshot,
  snapshotToPreview,
} from '../src/services/company-enrichment/enrichmentCache';

describe('enrichment snapshot cache', () => {
  it('validates cache when website matches and within TTL', () => {
    const at = new Date();
    expect(
      isEnrichmentCacheValid('https://acmehvac.com', at, 'https://acmehvac.com', false),
    ).toBe(true);
  });

  it('invalidates cache when website changes', () => {
    const at = new Date();
    expect(
      isEnrichmentCacheValid('https://acmehvac.com', at, 'https://otherco.com', false),
    ).toBe(false);
  });

  it('invalidates cache when force is true', () => {
    const at = new Date();
    expect(
      isEnrichmentCacheValid('https://acmehvac.com', at, 'https://acmehvac.com', true),
    ).toBe(false);
  });

  it('round-trips preview JSON', () => {
    const preview = {
      name: 'Acme',
      field_confidence: { name: 'high' as const },
      warnings: [],
    };
    const restored = snapshotToPreview(previewToSnapshot(preview));
    expect(restored?.name).toBe('Acme');
  });
});
