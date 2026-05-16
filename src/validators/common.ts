import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().optional(),
  status: z.string().optional(),
  sortBy: z.string().optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

export const projectIdParamSchema = z.object({
  projectId: z.string().uuid(),
});

export const serviceIdParamSchema = z.object({
  serviceId: z.string().uuid(),
});

export const conversationIdParamSchema = z.object({
  id: z.string().uuid(),
});
