export type FieldConfidence = 'high' | 'medium' | 'low';

export interface ExtractedField<T = string> {
  value: T;
  confidence: FieldConfidence;
}

export interface CompanyEnrichmentPreview {
  name?: string;
  industry?: string;
  website?: string;
  main_contact_name?: string;
  main_contact_email?: string;
  main_contact_phone?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  formatted_address?: string;
  google_business_url?: string;
  suggested_logo_url?: string;
  field_confidence: Record<string, FieldConfidence>;
  warnings: string[];
}

export interface RawExtraction {
  name?: ExtractedField;
  industry?: ExtractedField;
  website?: ExtractedField;
  main_contact_name?: ExtractedField;
  main_contact_email?: ExtractedField;
  main_contact_phone?: ExtractedField;
  address_line1?: ExtractedField;
  address_line2?: ExtractedField;
  city?: ExtractedField;
  state?: ExtractedField;
  postal_code?: ExtractedField;
  country?: ExtractedField;
  formatted_address?: ExtractedField;
  google_business_url?: ExtractedField;
  suggested_logo_url?: ExtractedField;
}
