import { z } from 'zod';

const projectStatus = z.enum([
  'not_started', 'in_progress', 'waiting_on_client', 'internal_review',
  'client_review', 'complete', 'paused',
]);
const priority = z.enum(['low', 'normal', 'high', 'urgent']);

export const createProjectSchema = z.object({
  company_id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  status: projectStatus.optional(),
  priority: priority.optional(),
  start_date: z.string().datetime().optional(),
  due_date: z.string().datetime().optional(),
  assigned_salesman_id: z.string().uuid().optional(),
  project_manager_id: z.string().uuid().optional(),
  client_facing_notes: z.string().optional(),
  internal_notes: z.string().optional(),
});

export const updateProjectSchema = createProjectSchema.partial().omit({ company_id: true });

export const createProjectServiceSchema = z.object({
  service_template_id: z.string().uuid().optional(),
  service_name: z.string().min(1),
  description: z.string().optional(),
  progress: z.number().min(0).max(100).optional(),
  status: projectStatus.optional(),
  manual_progress_override: z.boolean().optional(),
});

export const updateProjectServiceSchema = createProjectServiceSchema.partial();

export const createServiceStepSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum([
    'not_started', 'in_progress', 'waiting_on_client', 'internal_review',
    'client_review', 'complete', 'skipped',
  ]).optional(),
  sort_order: z.number().int().optional(),
  due_date: z.string().datetime().optional(),
});

export const updateServiceStepSchema = createServiceStepSchema.partial();

export const createProjectUpdateSchema = z.object({
  title: z.string().min(1),
  message: z.string().min(1),
  project_service_id: z.string().uuid().optional(),
  visibility: z.enum(['client_visible', 'internal_only']).optional(),
});

export const updateProjectUpdateSchema = createProjectUpdateSchema.partial();
