import { z } from 'zod';

export const createInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'client', 'salesman', 'employee']),
  company_id: z.string().uuid().optional(),
  expires_in_days: z.number().int().min(1).max(90).optional().default(7),
});

export const createConversationSchema = z.object({
  project_id: z.string().uuid().optional(),
  company_id: z.string().uuid().optional(),
  type: z.enum(['client_project', 'internal_project', 'admin_salesman', 'admin_employee']),
  member_ids: z.array(z.string().uuid()).optional(),
});

export const createMessageSchema = z.object({
  message: z.string().min(1),
  internal_only: z.boolean().optional(),
});

export const createApprovalSchema = z.object({
  project_id: z.string().uuid(),
  file_id: z.string().uuid().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
});

export const updateApprovalSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['waiting_for_client', 'approved', 'revisions_requested']).optional(),
  client_comments: z.string().optional(),
});

export const approvalCommentSchema = z.object({
  comment: z.string().min(1),
});

export const createClientRequestSchema = z.object({
  company_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  request_type: z.enum([
    'website_change', 'seo_question', 'ads_question', 'design_request',
    'automation_request', 'support_request', 'general_question',
  ]),
  title: z.string().min(1),
  description: z.string().min(1),
});

export const updateClientRequestSchema = z.object({
  status: z.enum(['submitted', 'in_review', 'in_progress', 'waiting_on_client', 'complete']).optional(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
});

export const createReportSchema = z.object({
  company_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  report_type: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().optional(),
  metrics_json: z.record(z.unknown()).optional(),
});

export const updateReportSchema = createReportSchema.partial().omit({ company_id: true });

export const createAnnouncementSchema = z.object({
  title: z.string().min(1),
  message: z.string().min(1),
  audience: z.enum(['all_clients', 'specific_client', 'internal_team', 'salesmen_only', 'everyone']),
  company_id: z.string().uuid().optional(),
});

export const updateAnnouncementSchema = createAnnouncementSchema.partial();

export const createInternalNoteSchema = z.object({
  project_id: z.string().uuid().optional(),
  company_id: z.string().uuid().optional(),
  note: z.string().min(1),
});

export const updateFileSchema = z.object({
  category: z.enum([
    'logos', 'brand_assets', 'website_content', 'photos', 'reports',
    'contracts', 'deliverables', 'ad_creatives', 'seo_documents', 'other',
  ]).optional(),
  status: z.enum(['uploaded', 'needs_review', 'approved', 'needs_revision']).optional(),
  file_name: z.string().optional(),
});

export const uploadFileSchema = z.object({
  company_id: z.string().uuid().optional(),
  project_id: z.string().uuid().optional(),
  task_id: z.string().uuid().optional(),
  category: z.enum([
    'logos', 'brand_assets', 'website_content', 'photos', 'reports',
    'contracts', 'deliverables', 'ad_creatives', 'seo_documents', 'other',
  ]).optional(),
});
