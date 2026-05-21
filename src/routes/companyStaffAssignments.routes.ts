import { Router } from 'express';
import * as companyStaffAssignmentsController from '../controllers/companyStaffAssignments.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import {
  companyIdParamSchema,
  companyStaffAssignmentParamSchema,
  createStaffAssignmentSchema,
  replaceStaffAssignmentsSchema,
} from '../validators/staffAssignments';

const router = Router({ mergeParams: true });
router.use(authenticate);

router.get(
  '/',
  validate(companyIdParamSchema, 'params'),
  companyStaffAssignmentsController.listForCompany,
);
router.put(
  '/',
  validate(companyIdParamSchema, 'params'),
  validate(replaceStaffAssignmentsSchema),
  companyStaffAssignmentsController.replaceForCompany,
);
router.post(
  '/',
  validate(companyIdParamSchema, 'params'),
  validate(createStaffAssignmentSchema),
  companyStaffAssignmentsController.createForCompany,
);
router.delete(
  '/:assignmentId',
  validate(companyStaffAssignmentParamSchema, 'params'),
  companyStaffAssignmentsController.removeFromCompany,
);

export default router;
