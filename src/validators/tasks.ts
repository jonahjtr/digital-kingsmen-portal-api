import { z } from 'zod';

const taskStatus = z.enum([
  'backlog', 'todo', 'in_progress', 'waiting_on_client',
  'internal_review', 'client_review', 'complete',
]);
const priority = z.enum(['low', 'normal', 'high', 'urgent']);
/** Accepts omitted, null, or empty string — normalizes empty to undefined on create. */
const optionalUuid = z.preprocess(
  (val) => (val === '' || val === null ? undefined : val),
  z.string().uuid().optional(),
);

/** For PATCH: allows explicit null to clear an anchor. */
const optionalNullableUuid = z.preprocess(
  (val) => (val === '' ? null : val),
  z.string().uuid().nullable().optional(),
);

const createAnchorFields = {
  company_id: optionalUuid,
  project_id: optionalUuid,
  project_service_id: optionalUuid,
};

const updateAnchorFields = {
  company_id: optionalNullableUuid,
  project_id: optionalNullableUuid,
  project_service_id: optionalNullableUuid,
};

export const createTaskSchema = z.object({
  ...createAnchorFields,
  title: z.string().min(1),
  description: z.string().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  status: taskStatus.optional(),
  priority: priority.optional(),
  due_date: z.string().datetime().optional(),
  client_visible: z.boolean().optional(),
});

export const updateTaskSchema = createTaskSchema
  .partial()
  .extend({
    ...updateAnchorFields,
    title: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    due_date: z.string().datetime().nullable().optional(),
    assigned_to: z.string().uuid().nullable().optional(),
    archived: z.boolean().optional(),
  });

export const createTaskCommentSchema = z.object({
  comment: z.string().min(1),
  internal_only: z.boolean().optional(),
});
