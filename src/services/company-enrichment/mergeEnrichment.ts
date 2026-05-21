import type { CompanyEnrichmentPreview, FieldConfidence, RawExtraction } from './types';

const PRIORITY: Record<FieldConfidence, number> = { high: 3, medium: 2, low: 1 };

function pickField(
  existing: { value?: string; confidence?: FieldConfidence },
  incoming: { value: string; confidence: FieldConfidence },
): { value: string; confidence: FieldConfidence } {
  if (!existing.value) return incoming;
  if (PRIORITY[incoming.confidence] > PRIORITY[existing.confidence!]) return incoming;
  return existing as { value: string; confidence: FieldConfidence };
}

export function rawToPreview(raw: RawExtraction, warnings: string[]): CompanyEnrichmentPreview {
  const field_confidence: Record<string, FieldConfidence> = {};
  const preview: CompanyEnrichmentPreview = { field_confidence, warnings };

  const map: Array<[keyof CompanyEnrichmentPreview, keyof RawExtraction]> = [
    ['name', 'name'],
    ['industry', 'industry'],
    ['website', 'website'],
    ['main_contact_name', 'main_contact_name'],
    ['main_contact_email', 'main_contact_email'],
    ['main_contact_phone', 'main_contact_phone'],
    ['address_line1', 'address_line1'],
    ['address_line2', 'address_line2'],
    ['city', 'city'],
    ['state', 'state'],
    ['postal_code', 'postal_code'],
    ['country', 'country'],
    ['formatted_address', 'formatted_address'],
    ['google_business_url', 'google_business_url'],
    ['suggested_logo_url', 'suggested_logo_url'],
  ];

  for (const [outKey, rawKey] of map) {
    const f = raw[rawKey];
    if (f?.value) {
      (preview as Record<string, string>)[outKey] = f.value;
      field_confidence[outKey] = f.confidence;
    }
  }

  if (!preview.country && (preview.state || preview.postal_code)) {
    preview.country = 'US';
    field_confidence.country = 'low';
  }

  if (!preview.formatted_address && preview.address_line1) {
    const parts = [
      preview.address_line1,
      preview.address_line2,
      preview.city,
      preview.state,
      preview.postal_code,
      preview.country,
    ].filter(Boolean);
    if (parts.length) {
      preview.formatted_address = parts.join(', ');
      field_confidence.formatted_address = field_confidence.address_line1 ?? 'medium';
    }
  }

  return preview;
}

export function mergeRawLayers(layers: Partial<RawExtraction>[]): RawExtraction {
  const merged: RawExtraction = {};
  for (const layer of layers) {
    for (const [key, incoming] of Object.entries(layer)) {
      if (!incoming) continue;
      const k = key as keyof RawExtraction;
      const existing = merged[k];
      if (!existing) {
        merged[k] = incoming;
        continue;
      }
      const picked = pickField(existing, incoming);
      merged[k] = picked;
    }
  }
  return merged;
}
