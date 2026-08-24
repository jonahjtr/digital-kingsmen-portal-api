import { z } from 'zod';

export const BUSINESS_EXPENSE_TYPES = ['contractor', 'software', 'media', 'other'] as const;

export const businessFinanceSummaryQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export const createBusinessRecurringExpenseSchema = z.object({
  name: z.string().min(1),
  vendor: z.string().optional().nullable(),
  expense_type: z.enum(BUSINESS_EXPENSE_TYPES).optional().default('other'),
  amount: z.number().min(0),
  currency: z.string().length(3).optional().default('USD'),
  is_active: z.boolean().optional().default(true),
  service_category: z.string().max(80).optional().nullable(),
  started_at: z.string().datetime().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const updateBusinessRecurringExpenseSchema =
  createBusinessRecurringExpenseSchema.partial();
