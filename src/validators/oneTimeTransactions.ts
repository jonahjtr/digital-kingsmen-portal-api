import { z } from 'zod';

export const ONE_TIME_TRANSACTION_CATEGORIES = [
  'website',
  'branding',
  'setup',
  'other',
] as const;

export const ONE_TIME_PAYMENT_STATUSES = [
  'unpaid',
  'partial',
  'paid',
  'waived',
  'failed',
] as const;

export const createOneTimeTransactionSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  category: z.enum(ONE_TIME_TRANSACTION_CATEGORIES).optional().default('other'),
  amount: z.number().positive().max(10_000_000),
  currency: z.string().length(3).optional().default('USD'),
  recognized_at: z.string().datetime(),
  payment_status: z.enum(ONE_TIME_PAYMENT_STATUSES).optional().default('unpaid'),
  project_id: z.string().uuid().optional().nullable(),
  salesman_id: z.string().uuid().optional().nullable(),
  salesman_payout: z.number().min(0).max(10_000_000).optional().nullable(),
  salesman_payout_override: z.boolean().optional(),
  notes: z.string().max(2000).optional().nullable(),
});

export const updateOneTimeTransactionSchema = createOneTimeTransactionSchema.partial();

export const companyIdParamSchema = z.object({
  companyId: z.string().uuid(),
});

export const transactionIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const listOneTimeTransactionsQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  company_id: z.string().uuid().optional(),
  salesman_id: z.string().uuid().optional(),
  project_id: z.string().uuid().optional(),
  category: z.enum(ONE_TIME_TRANSACTION_CATEGORIES).optional(),
  payment_status: z.enum(ONE_TIME_PAYMENT_STATUSES).optional(),
  search: z.string().max(200).optional(),
});
