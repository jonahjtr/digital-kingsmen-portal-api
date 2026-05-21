import { Router } from 'express';
import * as monthlyServicesController from '../controllers/monthlyServices.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import {
  listMonthlyServicesQuerySchema,
  updateMonthlyServiceSchema,
} from '../validators/monthlyServices';
import { idParamSchema } from '../validators/common';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  validate(listMonthlyServicesQuerySchema, 'query'),
  monthlyServicesController.listAll,
);
router.patch(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(updateMonthlyServiceSchema),
  monthlyServicesController.update,
);
router.delete(
  '/:id',
  validate(idParamSchema, 'params'),
  monthlyServicesController.remove,
);

export default router;
