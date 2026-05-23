import { z } from 'zod';

export const createConversationSchema = z.object({
  project_id: z.string().uuid().optional(),
  company_id: z.string().uuid().optional(),
  type: z.enum(['client_project', 'internal_project', 'admin_salesman', 'admin_employee']),
  member_ids: z.array(z.string().uuid()).optional(),
});

export const markConversationReadSchema = z.object({
  message_id: z.string().uuid().optional(),
});
