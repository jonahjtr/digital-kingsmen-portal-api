import { z } from 'zod';

/** Recurring retainers (MRR) — not one-time setup projects. */
export const BILLABLE_REVENUE_CATEGORIES = [
  'seo',
  'social_media',
  'google_ads',
  'meta_ads',
  'website_maintenance',
] as const;

/** @deprecated Use BILLABLE_REVENUE_CATEGORIES */
export const MONTHLY_SERVICE_CATEGORIES = BILLABLE_REVENUE_CATEGORIES;

export const DEFAULT_SALESMAN_SPLIT_PERCENT = 30;

export const createMonthlyServiceSchema = z.object({
  service_category: z.enum(BILLABLE_REVENUE_CATEGORIES),
  label: z.string().max(120).optional().nullable(),
  monthly_amount: z.number().positive().max(1_000_000),
  salesman_payout: z.number().min(0).max(1_000_000).optional().nullable(),
  salesman_payout_override: z.boolean().optional(),
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
  category: z.enum(BILLABLE_REVENUE_CATEGORIES).optional(),
  /** Comma-separated category ids, e.g. seo,google_ads */
  categories: z.string().max(200).optional(),
  status: z.enum(['active', 'paused', 'cancelled']).optional(),
  search: z.string().max(200).optional(),
  company_id: z.string().uuid().optional(),
  salesman_id: z.string().uuid().optional(),
  billable_only: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .optional(),
});
