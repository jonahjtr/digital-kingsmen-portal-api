import { Router } from 'express';
import * as usersController from '../controllers/users.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { createUserSchema, updateUserSchema } from '../validators/users';
import { idParamSchema } from '../validators/common';

const router = Router();
router.use(authenticate);

router.get('/', usersController.list);
router.get('/staff', usersController.listStaff);
router.get(
  '/:id/staff-assignments',
  validate(idParamSchema, 'params'),
  usersController.listStaffAssignments,
);
router.get('/:id', validate(idParamSchema, 'params'), usersController.getById);
router.post('/', validate(createUserSchema), usersController.create);
router.patch('/:id', validate(idParamSchema, 'params'), validate(updateUserSchema), usersController.update);
router.delete('/:id', validate(idParamSchema, 'params'), usersController.remove);

export default router;
