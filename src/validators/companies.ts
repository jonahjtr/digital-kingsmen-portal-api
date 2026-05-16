import { z } from 'zod';

export const createCompanySchema = z.object({
  name: z.string().min(1),
  website: z.string().optional(),
  industry: z.string().optional(),
  main_contact_name: z.string().optional(),
  main_contact_email: z.string().email().optional(),
  main_contact_phone: z.string().optional(),
  assigned_salesman_id: z.string().uuid().optional(),
  assigned_project_manager_id: z.string().uuid().optional(),
  status: z.enum(['active', 'inactive', 'prospect']).optional(),
  notes: z.string().optional(),
});

export const updateCompanySchema = createCompanySchema.partial();
