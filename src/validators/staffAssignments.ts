import { z } from 'zod';

export const createStaffAssignmentSchema = z.object({
  user_id: z.string().uuid(),
  staff_tag_id: z.string().min(1),
});

export const replaceStaffAssignmentsSchema = z.object({
  assignments: z.array(createStaffAssignmentSchema),
});

export const companyIdParamSchema = z.object({
  companyId: z.string().uuid(),
});

export const companyStaffAssignmentParamSchema = z.object({
  companyId: z.string().uuid(),
  assignmentId: z.string().uuid(),
});
