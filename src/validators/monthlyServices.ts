import { z } from 'zod';

export const MONTHLY_SERVICE_CATEGORIES = [
  'seo',
  'local_seo',
  'google_ads',
  'meta_ads',
  'google_business',
  'content',
  'other',
] as const;

export const createMonthlyServiceSchema = z.object({
  service_category: z.enum(MONTHLY_SERVICE_CATEGORIES),
  label: z.string().max(120).optional().nullable(),
  monthly_amount: z.number().positive().max(1_000_000),
  currency: z.string().length(3).optional().default('USD'),
  status: z.enum(['active', 'paused', 'cancelled']).optional(),
  description: z.string().max(2000).optional().nullable(),
  started_at: z.string().datetime().optional().nullable(),
});

export const updateMonthlyServiceSchema = createMonthlyServiceSchema.partial();

export const companyIdParamSchema = z.object({
  companyId: z.string().uuid(),
});

export const monthlyServiceIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const listMonthlyServicesQuerySchema = z.object({
  category: z.enum(MONTHLY_SERVICE_CATEGORIES).optional(),
  status: z.enum(['active', 'paused', 'cancelled']).optional(),
  search: z.string().max(200).optional(),
  company_id: z.string().uuid().optional(),
});
