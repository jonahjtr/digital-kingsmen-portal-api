import { z } from 'zod';

export const GBP_POST_STATUSES = ['draft', 'approved', 'ready', 'posted', 'expired'] as const;
export const GBP_POST_TYPES = ['update', 'offer', 'event'] as const;

export const gbpLocationIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const companyIdParamSchema = z.object({
  companyId: z.string().uuid(),
});

export const createGbpLocationSchema = z.object({
  name: z.string().min(1).max(200),
  google_business_url: z.string().url().max(500).optional().nullable(),
  formatted_address: z.string().max(500).optional().nullable(),
  is_primary: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(1000).optional(),
  external_location_id: z.string().max(200).optional().nullable(),
});

export const updateGbpLocationSchema = createGbpLocationSchema.partial();

export const listGbpPostsQuerySchema = z.object({
  company_id: z.string().uuid().optional(),
  location_id: z.string().uuid().optional(),
  status: z.enum(GBP_POST_STATUSES).optional(),
  search: z.string().max(200).optional(),
});

export const createGbpPostSchema = z.object({
  company_id: z.string().uuid(),
  post_code: z.string().min(1).max(80),
  status: z.enum(GBP_POST_STATUSES).optional(),
  post_type: z.enum(GBP_POST_TYPES).optional(),
  topic: z.string().max(300).optional().nullable(),
  description: z.string().min(1).max(1500),
  cta_type: z.string().max(80).optional().nullable(),
  cta_url: z.string().max(500).optional().nullable(),
  image_url: z.string().max(1000).optional().nullable(),
  image_guidance: z.string().max(2000).optional().nullable(),
  linked_content_url: z.string().max(500).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  location_ids: z.array(z.string().uuid()).min(1),
});

export const updateGbpPostSchema = z.object({
  post_code: z.string().min(1).max(80).optional(),
  status: z.enum(GBP_POST_STATUSES).optional(),
  post_type: z.enum(GBP_POST_TYPES).optional(),
  topic: z.string().max(300).optional().nullable(),
  description: z.string().min(1).max(1500).optional(),
  cta_type: z.string().max(80).optional().nullable(),
  cta_url: z.string().max(500).optional().nullable(),
  image_url: z.string().max(1000).optional().nullable(),
  image_guidance: z.string().max(2000).optional().nullable(),
  linked_content_url: z.string().max(500).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  location_ids: z.array(z.string().uuid()).min(1).optional(),
});
