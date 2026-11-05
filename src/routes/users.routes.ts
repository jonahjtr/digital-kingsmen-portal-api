import { Router } from 'express';
import * as usersController from '../controllers/users.controller';
import { authenticate } from '../middleware/authenticate';
import { blockWhileViewingAs } from '../controllers/impersonation.controller';
import { validate } from '../middleware/validate';
import { createUserSchema, updateUserSchema } from '../validators/users';
import {
  createCompanyUserSchema,
  updateCompanyUserSchema,
} from '../validators/companyUsers';
import { idParamSchema } from '../validators/common';
import { z } from 'zod';

const membershipParamSchema = z.object({
  id: z.string().uuid(),
  membershipId: z.string().uuid(),
});

const router = Router();
router.use(authenticate);
// Read-only while viewing as someone: no editing accounts/passwords as them.
router.use((req, res, next) => (req.method === 'GET' ? next() : blockWhileViewingAs(req, res, next)));

router.get('/', usersController.list);
router.get('/staff', usersController.listStaff);
router.get('/contacts', usersController.listContacts);
router.get(
  '/:id/staff-assignments',
  validate(idParamSchema, 'params'),
  usersController.listStaffAssignments,
);
router.get(
  '/:id/companies',
  validate(idParamSchema, 'params'),
  usersController.listContactCompanies,
);
router.post(
  '/:id/companies',
  validate(idParamSchema, 'params'),
  validate(createCompanyUserSchema),
  usersController.addContactCompany,
);
router.patch(
  '/:id/companies/:membershipId',
  validate(membershipParamSchema, 'params'),
  validate(updateCompanyUserSchema),
  usersController.updateContactCompany,
);
router.delete(
  '/:id/companies/:membershipId',
  validate(membershipParamSchema, 'params'),
  usersController.removeContactCompany,
);
router.get('/:id', validate(idParamSchema, 'params'), usersController.getById);
router.post('/', validate(createUserSchema), usersController.create);
router.patch('/:id', validate(idParamSchema, 'params'), validate(updateUserSchema), usersController.update);
router.delete('/:id', validate(idParamSchema, 'params'), usersController.remove);

export default router;
