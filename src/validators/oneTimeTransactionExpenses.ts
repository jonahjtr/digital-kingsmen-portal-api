import { z } from 'zod';

export const ONE_TIME_TRANSACTION_EXPENSE_TYPES = [
  'contractor',
  'software',
  'media',
  'other',
] as const;

export const createOneTimeTransactionExpenseSchema = z.object({
  name: z.string().min(1),
  vendor: z.string().optional().nullable(),
  expense_type: z.enum(ONE_TIME_TRANSACTION_EXPENSE_TYPES).default('contractor'),
  amount: z.number().min(0),
  currency: z.string().length(3).optional(),
  spent_at: z.string().datetime().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const updateOneTimeTransactionExpenseSchema =
  createOneTimeTransactionExpenseSchema.partial();

export const transactionExpenseIdParamSchema = z.object({
  id: z.string().uuid(),
  expenseId: z.string().uuid(),
});
