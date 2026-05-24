import { z } from 'zod';
import { normalizeWebsiteUrl } from '../services/company-enrichment/normalizeUrl';
import { createStaffAssignmentSchema } from './staffAssignments';

function isValidWebsiteUrl(value: string): boolean {
  try {
    normalizeWebsiteUrl(value);
    return true;
  } catch {
    return false;
  }
}

const websiteUrlField = z
  .string()
  .min(1, 'Website URL is required')
  .refine(isValidWebsiteUrl, 'Enter a valid website URL (e.g. https://example.com)');

const optionalUrl = z
  .string()
  .min(1)
  .refine(isValidWebsiteUrl, 'Enter a valid website URL (e.g. https://example.com)')
  .optional();
const optionalEmail = z.union([z.string().email(), z.literal('')]).optional();

const addressFields = {
  google_business_url: optionalUrl,
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postal_code: z.string().optional(),
  country: z.string().optional(),
  formatted_address: z.string().optional(),
  enrichment_source: z.string().optional(),
  enrichment_applied: z.boolean().optional(),
  enrichment_snapshot: z.union([z.string(), z.record(z.unknown())]).optional(),
};

export const createCompanySchema = z.object({
  name: z.string().min(1),
  website: optionalUrl,
  industry: z.string().optional(),
  main_contact_name: z.string().optional(),
  main_contact_email: optionalEmail,
  main_contact_phone: z.string().optional(),
  assigned_salesman_id: z.string().uuid().optional(),
  assigned_project_manager_id: z.string().uuid().optional(),
  status: z.enum(['active', 'inactive', 'prospect']).optional(),
  notes: z.string().optional(),
  staff_assignments: z.array(createStaffAssignmentSchema).optional(),
  import_logo_from_url: z.string().url().optional(),
  ...addressFields,
});

export const updateCompanySchema = createCompanySchema.partial();

export const enrichPreviewSchema = z.object({
  website: websiteUrlField,
  google_business_url: z.string().optional(),
  company_id: z.string().uuid().optional(),
  force: z.boolean().optional(),
  persist: z.boolean().optional(),
});

export const importLogoFromUrlSchema = z.object({
  url: z.string().url('Logo URL must be a valid URL'),
});
