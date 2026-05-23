import { z } from 'zod';

export const MONTHLY_SERVICE_EXPENSE_TYPES = [
  'contractor',
  'software',
  'media',
  'other',
] as const;

export const createMonthlyServiceExpenseSchema = z.object({
  name: z.string().min(1),
  vendor: z.string().optional(),
  expense_type: z.enum(MONTHLY_SERVICE_EXPENSE_TYPES).default('contractor'),
  amount: z.number().min(0),
  currency: z.string().length(3).optional(),
  is_recurring: z.boolean().optional(),
  notes: z.string().optional(),
});

export const updateMonthlyServiceExpenseSchema = createMonthlyServiceExpenseSchema.partial();

export const expenseIdParamSchema = z.object({
  id: z.string().uuid(),
  expenseId: z.string().uuid(),
});
