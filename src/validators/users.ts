import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(1),
  phone: z.string().optional(),
  role: z.enum(['admin', 'client', 'salesman', 'employee']),
  avatar_url: z.string().url().optional(),
});

export const updateUserSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  full_name: z.string().min(1).optional(),
  phone: z.string().nullable().optional(),
  role: z.enum(['admin', 'client', 'salesman', 'employee']).optional(),
  avatar_url: z.string().url().nullable().optional(),
  is_active: z.boolean().optional(),
});
