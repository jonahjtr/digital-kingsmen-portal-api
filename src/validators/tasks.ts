import { z } from 'zod';

export const createTaskSchema = z.object({
  project_id: z.string().uuid(),
  project_service_id: z.string().uuid().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  status: z.enum([
    'backlog', 'todo', 'in_progress', 'waiting_on_client',
    'internal_review', 'client_review', 'complete',
  ]).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  due_date: z.string().datetime().optional(),
  client_visible: z.boolean().optional(),
});

export const updateTaskSchema = createTaskSchema.partial().omit({ project_id: true });

export const createTaskCommentSchema = z.object({
  comment: z.string().min(1),
  internal_only: z.boolean().optional(),
});
