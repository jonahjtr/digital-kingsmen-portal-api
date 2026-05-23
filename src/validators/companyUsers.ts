import { z } from 'zod';

export const COMPANY_USER_RELATIONSHIPS = [
  'primary_contact',
  'contact',
  'billing',
] as const;

export const createCompanyUserSchema = z.object({
  company_id: z.string().uuid(),
  relationship_type: z.enum(COMPANY_USER_RELATIONSHIPS).default('contact'),
});

export const updateCompanyUserSchema = z.object({
  relationship_type: z.enum(COMPANY_USER_RELATIONSHIPS),
});
